import axios from 'axios';
import { getCached, setCached } from '../cache';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { utmSridSqlExpr } from './utm';
import { sanearSobreposicao, checarPercentual } from './sanidade-numerica';
import { descobrirCamadaWfs } from './wfs-descoberta';
import { consultarRestricaoWfs, descreverFonteWfs, type EvidenciaWfs } from './restricoes-wfs';

const TERRABRASILIS_WFS = 'https://terrabrasilis.dpi.inpe.br/geoserver/ows';

export interface ProdesResult {
  totalAreaHa: number;
  porAno: Array<{ ano: number; areaHa: number; count: number }>;
  poligonos: number;
  fonte: string;
  consultadoEm: string;
  geoJsonFeatures?: any[];
}

export interface SobreposicaoArea {
  nome: string;
  tipo: 'TI' | 'Quilombola' | 'UC' | 'Assentamento';
  /** liga a área à sua geometria em geoJsonFeatures (antes era por posição e desalinhava) */
  featKey?: string;
  categoria?: string;
  percentualSobreposicao: number;
  areaIntersecaoHa: number;
  /** sanidade numérica falhou — exibir o motivo no lugar dos números */
  aVerificar?: string;
  nivelRisco: 'alto' | 'medio' | 'baixo';
}

export interface SobreposicaoResult {
  terrasIndigenas: SobreposicaoArea[];
  quilombolas: SobreposicaoArea[];
  unidadesConservacao: SobreposicaoArea[];
  assentamentos?: SobreposicaoArea[];
  totalSobreposicoes: number;
  /**
   * 'nenhum' só quando TODAS as camadas responderam e nenhuma sobreposição foi encontrada.
   * 'indeterminado' quando alguma camada falhou e nada foi encontrado nas demais
   * (falha de fonte não é ausência de restrição).
   */
  riscoMaximo: 'alto' | 'medio' | 'baixo' | 'nenhum' | 'indeterminado';
  /** Resultado da consulta de cada camada: 'consultada' ou 'falhou'. */
  camadas?: Record<'terraIndigena' | 'quilombola' | 'unidadeConservacao' | 'assentamento', 'consultada' | 'falhou' | 'nao_configurada'>;
  evidencias?: Partial<Record<'terraIndigena' | 'quilombola' | 'unidadeConservacao', EvidenciaWfs>>;
  fonte: string;
  consultadoEm: string;
  geoJsonFeatures?: any[];
}

export interface CarVsIncraResult {
  areaCarHa: number | null;
  areaIncraHa: number | null;
  diferencaHa: number | null;
  diferencaPct: number | null;
  alertaDiscrepancia: boolean;
  sobreposicaoGeometrica: {
    areaIntersecaoHa: number | null;
    percentualSobreposicao: number | null;
    /** sanidade numérica falhou — motivo substitui os números na exibição */
    aVerificar?: string;
    carCobreIncra: boolean;
    geoJsonIntersecao: any | null;
    carPolygonGeoJson: any | null;
  } | null;
  fonte: string;
  consultadoEm: string;
}

export interface SicorOperacao {
  programa: string;
  subprograma?: string;
  instituicao?: string;
  valor: number;
  area?: number;
  safra?: string;
  situacao?: string;
  dataContratacao?: string;
}

export interface SicorTitularResult {
  cpfCnpj: string;
  totalOperacoes: number;
  valorTotal: number;
  operacoes: SicorOperacao[];
  temHipotecaAtiva: boolean;
  fonte: string;
  consultadoEm: string;
}

export interface ItrVtnResult {
  nirf?: string;
  vtn: number | null;
  vtnPorHa: number | null;
  areaDeclarada: number | null;
  aliquota: number | null;
  fonte: string;
  consultadoEm: string;
}

export interface GeoLayer {
  type: string;
  features: any[];
}

export interface DueDiligenceFundiariaResult {
  codigoIncra: string;
  cpfCnpj?: string;
  prodes: ProdesResult | null;
  sobreposicoes: SobreposicaoResult | null;
  carVsIncra: CarVsIncraResult | null;
  sicor: SicorTitularResult | null;
  itrVtn: ItrVtnResult | null;
  scoreRiscoFundiario: number;
  scoreBreakdown: {
    ambiental: number;
    juridico: number;
    documental: number;
    financeiro: number;
    valuation: number;
  };
  geoLayers: {
    prodesFeatures: GeoLayer | null;
    sobreposicoesFeatures: GeoLayer | null;
    assetPoint: { lat: number; lon: number } | null;
    sigefPolygon: any | null;
    assetPolygon: any | null;
    carPolygon: any | null;
    carIncraIntersection: any | null;
  };
  consultadoEm: string;
  status: Record<string, 'sucesso' | 'erro' | 'indisponivel' | 'pendente'>;
}

async function fetchSigefPolygon(
  codigoIncra: string
): Promise<{ polygon: any; fonte: string } | null> {
  const codNorm = codigoIncra.replace(/[.\-\/\s]/g, '');
  const cacheKey = `sigef_polygon:${codNorm}`;
  const cached = await getCached<{ polygon: any; fonte: string }>('due_diligence', cacheKey);
  if (cached) return cached;

  const sigefEndpoints = [
    {
      url: `https://sigef.incra.gov.br/geo/parcela/geo.json?codigo_imovel=${encodeURIComponent(codigoIncra)}`,
      extract: (data: any) => data?.features?.[0]?.geometry || data?.geometry || null,
      fonte: 'SIGEF/INCRA — parcela certificada',
    },
    {
      url: `https://sigef.incra.gov.br/api/v1/parcela/?codigo_imovel=${encodeURIComponent(codigoIncra)}&format=geojson`,
      extract: (data: any) => data?.features?.[0]?.geometry || null,
      fonte: 'SIGEF/INCRA API — parcela certificada',
    },
    {
      url: `https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=certificados&service=WFS&version=2.0.0&request=GetFeature&typeName=certificados&outputFormat=application/json&CQL_FILTER=parcela_co='${codNorm}'&maxFeatures=1`,
      extract: (data: any) => data?.features?.[0]?.geometry || null,
      fonte: 'Acervo Fundiário INCRA WFS — parcela certificada',
    },
  ];

  for (const endpoint of sigefEndpoints) {
    try {
      const resp = await fetch(endpoint.url, {
        signal: AbortSignal.timeout(12000),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MavrionConnect/1.0',
        },
      });
      if (!resp.ok) continue;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json') && !contentType.includes('geo')) continue;
      const data = await resp.json();
      const polygon = endpoint.extract(data);
      if (polygon && (polygon.type === 'Polygon' || polygon.type === 'MultiPolygon')) {
        const result = { polygon, fonte: endpoint.fonte };
        await setCached('due_diligence', cacheKey, result);
        console.log(`[DD] Polígono SIGEF encontrado via ${endpoint.fonte}`);
        return result;
      }
    } catch (err) {
      console.warn(`[DD] SIGEF endpoint falhou: ${endpoint.url.substring(0, 60)}... - ${(err as Error).message}`);
    }
  }

  console.log(`[DD] Polígono SIGEF não encontrado para código ${codigoIncra} — endpoints SIGEF/INCRA indisponíveis ou sem resposta`);
  return null;
}

function wktPolygonFromBbox(lat: number, lon: number, radiusDeg: number = 0.15): string {
  const s = lat - radiusDeg;
  const n = lat + radiusDeg;
  const w = lon - radiusDeg;
  const e = lon + radiusDeg;
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

export async function consultarProdesHistorico(
  lat: number,
  lon: number,
  radiusDeg: number = 0.15,
  overrideBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number }
): Promise<ProdesResult | null> {
  const cacheKey = overrideBbox
    ? `prodes:bbox:${overrideBbox.minLon.toFixed(3)},${overrideBbox.minLat.toFixed(3)},${overrideBbox.maxLon.toFixed(3)},${overrideBbox.maxLat.toFixed(3)}`
    : `prodes:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = await getCached<ProdesResult>('due_diligence', cacheKey);
  if (cached) return cached;

  try {
    const bbox = overrideBbox
      ? `${overrideBbox.minLon},${overrideBbox.minLat},${overrideBbox.maxLon},${overrideBbox.maxLat}`
      : `${lon - radiusDeg},${lat - radiusDeg},${lon + radiusDeg},${lat + radiusDeg}`;
    const layers = [
      'prodes-amz:yearly_deforestation',
      'prodes-cerrado-nb:yearly_deforestation_cerrado',
    ];

    const allFeatures: any[] = [];

    for (const layer of layers) {
      try {
        const params = new URLSearchParams({
          service: 'WFS',
          version: '1.0.0',
          request: 'GetFeature',
          typeName: layer,
          outputFormat: 'application/json',
          maxFeatures: '200',
          srsName: 'EPSG:4674',
          CQL_FILTER: `BBOX(geom,${bbox})`,
        });

        const res = await fetch(`${TERRABRASILIS_WFS}?${params}`, {
          signal: AbortSignal.timeout(20000),
        });

        if (res.ok) {
          const data = await res.json() as any;
          if (data?.features) {
            allFeatures.push(...data.features);
          }
        }
      } catch (err) {
        console.warn(`[PRODES] Erro na layer ${layer}:`, (err as Error).message);
      }
    }

    const porAnoMap = new Map<number, { areaHa: number; count: number }>();
    let totalAreaHa = 0;

    for (const f of allFeatures) {
      const p = f.properties || {};
      const ano = p.year || p.ano || p.main_class || 0;
      let areaHa = 0;
      if (p.area_ha) {
        areaHa = Number(p.area_ha);
      } else if (p.area_km) {
        areaHa = Number(p.area_km) * 100;
      } else if (p.areamunkm) {
        areaHa = Number(p.areamunkm) * 100;
      } else if (p.areameters) {
        areaHa = Number(p.areameters) / 10000;
      }

      if (ano && areaHa > 0) {
        const existing = porAnoMap.get(ano) || { areaHa: 0, count: 0 };
        existing.areaHa += areaHa;
        existing.count += 1;
        porAnoMap.set(ano, existing);
        totalAreaHa += areaHa;
      }
    }

    const porAno = Array.from(porAnoMap.entries())
      .map(([ano, data]) => ({
        ano,
        areaHa: Math.round(data.areaHa * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => a.ano - b.ano);

    const geoJsonFeatures = allFeatures
      .filter(f => f.geometry)
      .map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          ano: f.properties?.year || f.properties?.ano || 0,
          areaHa: f.properties?.area_ha || 0,
          layer: 'prodes',
        },
      }));

    const result: ProdesResult = {
      totalAreaHa: Math.round(totalAreaHa * 100) / 100,
      porAno,
      poligonos: allFeatures.length,
      fonte: 'PRODES/INPE via TerraBrasilis',
      consultadoEm: new Date().toISOString(),
      geoJsonFeatures,
    };

    await setCached('due_diligence', cacheKey, result);
    return result;
  } catch (err) {
    console.error('[PRODES] Erro:', (err as Error).message);
    return null;
  }
}

export function calcularRiscoSobreposicao(r: {
  terrasIndigenas: SobreposicaoArea[];
  quilombolas: SobreposicaoArea[];
  unidadesConservacao: SobreposicaoArea[];
  assentamentos?: SobreposicaoArea[];
  camadas?: SobreposicaoResult['camadas'];
}): SobreposicaoResult['riscoMaximo'] {
  const assent = r.assentamentos || [];
  if (r.terrasIndigenas.length > 0 || r.quilombolas.length > 0 || assent.length > 0) return 'alto';
  if (r.unidadesConservacao.some(uc => uc.nivelRisco === 'alto')) return 'alto';
  if (r.unidadesConservacao.length > 0) return 'medio';
  // Nada encontrado: só vale "nenhum" se todas as camadas consultadas responderam.
  if (r.camadas && Object.values(r.camadas).includes('falhou')) return 'indeterminado';
  return 'nenhum';
}

export async function consultarSobreposicoes(
  lat: number,
  lon: number,
  _areaPropertyHa: number | null,
  radiusDeg: number = 0.15,
  overrideBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  opts: { usarCache?: boolean } = {},
): Promise<SobreposicaoResult | null> {
  // Sem arredondamento: fazendas vizinhas não podem compartilhar resultados.
  // Versão nova invalida resultados das fontes antigas.
  const cacheKey = overrideBbox
    ? `sobreposicao:wfs-v2:bbox:${overrideBbox.minLon},${overrideBbox.minLat},${overrideBbox.maxLon},${overrideBbox.maxLat}`
    : `sobreposicao:wfs-v2:${lat},${lon}:${radiusDeg}`;
  const cached = opts.usarCache === false ? null : await getCached<SobreposicaoResult>('due_diligence', cacheKey);
  if (cached) return cached;

  const bbox = overrideBbox
    ? `${overrideBbox.minLon},${overrideBbox.minLat},${overrideBbox.maxLon},${overrideBbox.maxLat}`
    : `${lon - radiusDeg},${lat - radiusDeg},${lon + radiusDeg},${lat + radiusDeg}`;
  const bboxConsulta = overrideBbox ?? {
    minLon: lon - radiusDeg, minLat: lat - radiusDeg,
    maxLon: lon + radiusDeg, maxLat: lat + radiusDeg,
  };
  const evidencias: NonNullable<SobreposicaoResult['evidencias']> = {};

  const terrasIndigenas: SobreposicaoArea[] = [];
  const quilombolas: SobreposicaoArea[] = [];
  const unidadesConservacao: SobreposicaoArea[] = [];
  const assentamentos: SobreposicaoArea[] = [];
  const allOverlapFeatures: any[] = [];
  const camadas: NonNullable<SobreposicaoResult['camadas']> = {
    terraIndigena: 'falhou', quilombola: 'falhou', unidadeConservacao: 'falhou', assentamento: 'nao_configurada',
  };
  let featSeq = 0;
  const nextKey = (t: string) => `${t}:${featSeq++}`;

  try {
    const [tiConsulta, quilConsulta, ucConsulta] = await Promise.all([
      consultarRestricaoWfs('terraIndigena', bboxConsulta),
      consultarRestricaoWfs('quilombola', bboxConsulta),
      consultarRestricaoWfs('unidadeConservacao', bboxConsulta),
    ]);
    evidencias.terraIndigena = tiConsulta.evidencia;
    evidencias.quilombola = quilConsulta.evidencia;
    evidencias.unidadeConservacao = ucConsulta.evidencia;

    try {
      if (tiConsulta.ok) {
        const tiData = tiConsulta;
        if (Array.isArray(tiData?.features)) camadas.terraIndigena = 'consultada';
        for (const f of (tiData?.features || [])) {
          const p = f.properties || {};
          const nome = p.no_ti;
          const featKey = nextKey('ti');
          terrasIndigenas.push({
            nome,
            featKey,
            tipo: 'TI',
            categoria: p.ds_fase_ti || 'Não informada',
            percentualSobreposicao: 0,
            areaIntersecaoHa: 0,
            nivelRisco: 'alto',
          });
          if (f.geometry) {
            allOverlapFeatures.push({
              type: 'Feature',
              geometry: f.geometry,
              properties: { nome, tipo: 'TI', layer: 'ti', featKey },
            });
          }
        }
      }
    } catch (err) {
      console.warn('[TI FUNAI] Erro:', (err as Error).message);
    }

    try {
      if (quilConsulta.ok) {
        const quilData = quilConsulta;
        if (Array.isArray(quilData?.features)) camadas.quilombola = 'consultada';
        for (const f of (quilData?.features || [])) {
          const p = f.properties || {};
          const nome = p.nm_tq;
          const featKey = nextKey('quil');
          quilombolas.push({
            nome,
            featKey,
            tipo: 'Quilombola',
            categoria: p.status || 'Não informada',
            percentualSobreposicao: 0,
            areaIntersecaoHa: 0,
            nivelRisco: 'alto',
          });
          if (f.geometry) {
            allOverlapFeatures.push({
              type: 'Feature',
              geometry: f.geometry,
              properties: { nome, tipo: 'Quilombola', layer: 'quilombola', featKey },
            });
          }
        }
      }
    } catch (err) {
      console.warn('[Quilombola] Erro:', (err as Error).message);
    }

    try {
      if (ucConsulta.ok) {
        const ucData = ucConsulta;
        if (Array.isArray(ucData?.features)) camadas.unidadeConservacao = 'consultada';
        for (const f of (ucData?.features || [])) {
          const p = f.properties || {};
          const categoriaUc = p.categoria || p.grupo || '';
          const nome = p.nome_uc;
          const isProtecaoIntegral = String(p.grupo).toLowerCase().includes('integral') ||
            categoriaUc.toLowerCase().includes('integral') ||
            ['PARNA', 'ESEC', 'REBIO', 'REVIS', 'MONAT'].some(t => categoriaUc.toUpperCase().includes(t));

          const featKey = nextKey('uc');
          unidadesConservacao.push({
            nome,
            featKey,
            tipo: 'UC',
            categoria: categoriaUc,
            percentualSobreposicao: 0,
            areaIntersecaoHa: 0,
            nivelRisco: isProtecaoIntegral ? 'alto' : 'medio',
          });
          if (f.geometry) {
            allOverlapFeatures.push({
              type: 'Feature',
              geometry: f.geometry,
              properties: { nome, tipo: 'UC', categoria: categoriaUc, layer: 'uc', featKey },
            });
          }
        }
      }
    } catch (err) {
      console.warn('[UC ICMBio] Erro:', (err as Error).message);
    }

    // Assentamentos INCRA: o nome da camada WFS varia/muda, então só é consultada se configurada
    // (INCRA_ASSENTAMENTOS_WFS_LAYER, ex.: "assentamentos:assentamentos"). Sem isso: 'nao_configurada'.
    const layerAssent = process.env.INCRA_ASSENTAMENTOS_WFS_LAYER
      || await descobrirCamadaWfs('https://geoservicos.incra.gov.br/geoserver/ows', /assentamento/i, { preferir: /projeto|pa_|assentamentos?$/i, evitar: /ponto|quilomb/i });
    if (layerAssent) {
      camadas.assentamento = 'falhou';
      try {
        const asParams = new URLSearchParams({
          service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: layerAssent,
          outputFormat: 'application/json', maxFeatures: '50', srsName: 'EPSG:4326',
          CQL_FILTER: `BBOX(geom,${bbox})`,
        });
        const asRes = await fetch(`https://geoservicos.incra.gov.br/geoserver/ows?${asParams}`, { signal: AbortSignal.timeout(15000) });
        if (asRes.ok) {
          const asData = await asRes.json() as any;
          if (Array.isArray(asData?.features)) camadas.assentamento = 'consultada';
          for (const f of (asData?.features || [])) {
            const p = f.properties || {};
            const nome = p.nome_proje || p.nm_projeto || p.nome || 'Projeto de assentamento';
            const featKey = nextKey('as');
            assentamentos.push({
              nome, featKey, tipo: 'Assentamento', categoria: p.fase || p.situacao || 'Não informada',
              percentualSobreposicao: 0, areaIntersecaoHa: 0, nivelRisco: 'alto',
            });
            if (f.geometry) {
              allOverlapFeatures.push({ type: 'Feature', geometry: f.geometry, properties: { nome, tipo: 'Assentamento', layer: 'assentamento', featKey } });
            }
          }
        }
      } catch (err) {
        console.warn('[Assentamento INCRA] Erro:', (err as Error).message);
      }
    }

    const totalSobreposicoes = terrasIndigenas.length + quilombolas.length + unidadesConservacao.length + assentamentos.length;
    const riscoMaximo = calcularRiscoSobreposicao({ terrasIndigenas, quilombolas, unidadesConservacao, assentamentos, camadas });

    const result: SobreposicaoResult = {
      terrasIndigenas,
      quilombolas,
      unidadesConservacao,
      assentamentos,
      camadas,
      evidencias,
      totalSobreposicoes,
      riscoMaximo,
      fonte: `${Object.values(evidencias).map(descreverFonteWfs).join(' | ')} — detecção por BBOX, não por interseção geométrica`,
      consultadoEm: new Date().toISOString(),
      geoJsonFeatures: allOverlapFeatures,
    };

    // Não guarda em cache quando alguma camada falhou: senão a falha temporária ficaria "congelada".
    const algumaFalhou = Object.values(camadas).includes('falhou');
    if (!algumaFalhou && opts.usarCache !== false) await setCached('due_diligence', cacheKey, result);
    return result;
  } catch (err) {
    console.error('[Sobreposição] Erro:', (err as Error).message);
    return null;
  }
}

async function fetchCarPolygonFromSicar(
  codigoCar: string,
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }
): Promise<any | null> {
  const sicarWfsUrl = 'https://geoserver.car.gov.br/geoserver/sicar/wfs';
  const bboxStr = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`;
  const layers = [
    'sicar:imovel',
    'sicar:sicar_imoveis_poligonos',
  ];

  for (const layer of layers) {
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeName: layer,
        outputFormat: 'application/json',
        srsName: 'EPSG:4326',
        bbox: bboxStr + ',EPSG:4326',
        maxFeatures: '50',
      });
      const url = `${sicarWfsUrl}?${params}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.features?.length) {
        const codNorm = codigoCar.replace(/[.\-\/]/g, '').toUpperCase();
        const match = data.features.find((f: any) => {
          const props = f.properties || {};
          const featureCod = (props.cod_imovel || props.cod_car || props.numero_car || props.cod || '').toString().replace(/[.\-\/]/g, '').toUpperCase();
          return featureCod === codNorm;
        });
        if (match?.geometry) return match.geometry;
      }
    } catch {}
  }
  return null;
}

async function computeCarIncraGeometricOverlap(
  assetId: number,
  codigoCar?: string,
  assetBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  referenceGeoJson?: any
): Promise<{ overlap: CarVsIncraResult['sobreposicaoGeometrica']; carAreaHa: number | null }> {
  try {
    let carGeoJson: any = null;

    if (codigoCar && assetBbox) {
      carGeoJson = await fetchCarPolygonFromSicar(codigoCar, assetBbox);
    }

    if (!carGeoJson) {
      console.log('[DD] CAR polygon não encontrado via SICAR WFS — sobreposição geométrica indisponível');
      return { overlap: null, carAreaHa: null };
    }

    const carPolygonCopy = JSON.parse(JSON.stringify(carGeoJson));
    const carGeoStr = JSON.stringify(carGeoJson);
    const incraGeoStr = referenceGeoJson ? JSON.stringify(referenceGeoJson) : null;

    // SRID UTM derivado do centróide da geometria de referência (não mais
    // EPSG:32723 fixo — errado fora da zona 23S)
    const rows = await db.execute(sql`
      WITH incra_geom AS (
        ${incraGeoStr
          ? sql`SELECT ST_SetSRID(ST_GeomFromGeoJSON(${incraGeoStr}), 4326) as geom`
          : sql`SELECT geom FROM assets WHERE id = ${assetId} AND geom IS NOT NULL`
        }
      ),
      car_geom AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(${carGeoStr}), 4326) as geom
      ),
      srid AS (
        SELECT ${sql.raw(utmSridSqlExpr("(SELECT geom FROM incra_geom)"))} AS s
      )
      SELECT
        ROUND(CAST(
          ST_Area(ST_Intersection(
            ST_Transform((SELECT geom FROM incra_geom), (SELECT s FROM srid)),
            ST_Transform((SELECT geom FROM car_geom), (SELECT s FROM srid))
          )) / 10000 AS numeric
        ), 2) as intersect_ha,
        ROUND(CAST(
          ST_Area(ST_Intersection(
            ST_Transform((SELECT geom FROM incra_geom), (SELECT s FROM srid)),
            ST_Transform((SELECT geom FROM car_geom), (SELECT s FROM srid))
          )) * 100.0 /
          NULLIF(ST_Area(ST_Transform((SELECT geom FROM incra_geom), (SELECT s FROM srid))), 0)
        AS numeric), 1) as overlap_pct,
        ST_AsGeoJSON(ST_Intersection(
          (SELECT geom FROM incra_geom),
          (SELECT geom FROM car_geom)
        )) as intersect_geojson,
        ST_Contains(
          (SELECT geom FROM car_geom),
          (SELECT geom FROM incra_geom)
        ) as car_covers_incra,
        ROUND(CAST(
          ST_Area(ST_Transform((SELECT geom FROM car_geom), (SELECT s FROM srid))) / 10000 AS numeric
        ), 2) as car_area_ha
      WHERE ST_Intersects(
        (SELECT geom FROM incra_geom),
        (SELECT geom FROM car_geom)
      )
    `);
    const row = (rows as any).rows?.[0];
    if (row) {
      return {
        overlap: {
          areaIntersecaoHa: Number(row.intersect_ha),
          percentualSobreposicao: Number(row.overlap_pct),
          carCobreIncra: Boolean(row.car_covers_incra),
          geoJsonIntersecao: row.intersect_geojson ? JSON.parse(row.intersect_geojson) : null,
          carPolygonGeoJson: carPolygonCopy,
        },
        carAreaHa: Number(row.car_area_ha) || null,
      };
    }

    const carAreaRows = await db.execute(sql`
      WITH g AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${carGeoStr}), 4326) AS geom)
      SELECT ROUND(CAST(
        ST_Area(ST_Transform((SELECT geom FROM g), ${sql.raw(utmSridSqlExpr("(SELECT geom FROM g)"))})) / 10000 AS numeric
      ), 2) as car_area_ha
    `);
    const carRow = (carAreaRows as any).rows?.[0];
    return {
      overlap: {
        areaIntersecaoHa: 0,
        percentualSobreposicao: 0,
        carCobreIncra: false,
        geoJsonIntersecao: null,
        carPolygonGeoJson: carPolygonCopy,
      },
      carAreaHa: carRow ? Number(carRow.car_area_ha) || null : null,
    };
  } catch (err) {
    console.warn('[DD] Erro ao computar sobreposição CAR vs INCRA:', (err as Error).message);
  }
  return { overlap: null, carAreaHa: null };
}

export async function compararCarVsIncra(
  areaCarHa: number | null,
  areaIncraHa: number | null,
  assetId?: number,
  codigoCar?: string,
  assetBbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  referenceGeoJson?: any
): Promise<CarVsIncraResult> {
  let effectiveCarArea = areaCarHa;
  let sobreposicaoGeometrica: CarVsIncraResult['sobreposicaoGeometrica'] = null;

  if (assetId) {
    const { overlap, carAreaHa: computedCarArea } = await computeCarIncraGeometricOverlap(
      assetId, codigoCar, assetBbox, referenceGeoJson
    );
    sobreposicaoGeometrica = overlap;
    if (computedCarArea !== null && (effectiveCarArea === null || effectiveCarArea === undefined)) {
      effectiveCarArea = computedCarArea;
    }
  }

  // sanidade: interseção ≤ menor área e pct ≤ 100 — falha vira "a verificar"
  if (sobreposicaoGeometrica) {
    const san = sanearSobreposicao({
      sobreposicaoHa: sobreposicaoGeometrica.areaIntersecaoHa,
      sobreposicaoPct: sobreposicaoGeometrica.percentualSobreposicao,
      areaMenorHa: effectiveCarArea,
      areaOutraHa: areaIncraHa,
      contexto: 'sobreposição geométrica CAR×INCRA (PostGIS)',
    });
    sobreposicaoGeometrica = {
      ...sobreposicaoGeometrica,
      areaIntersecaoHa: san.sobreposicaoHa,
      percentualSobreposicao: san.sobreposicaoPct,
      ...(san.sobreposicaoAVerificar ? { aVerificar: san.sobreposicaoAVerificar } : {}),
    };
  }

  let diferencaHa: number | null = null;
  let diferencaPct: number | null = null;
  let alertaDiscrepancia = false;

  if (effectiveCarArea !== null && effectiveCarArea !== undefined && areaIncraHa !== null && areaIncraHa > 0) {
    diferencaHa = Math.round((effectiveCarArea - areaIncraHa) * 100) / 100;
    diferencaPct = Math.round(((effectiveCarArea - areaIncraHa) / areaIncraHa) * 100 * 10) / 10;
    alertaDiscrepancia = Math.abs(diferencaPct) > 5;
  }

  return {
    areaCarHa: effectiveCarArea ?? areaCarHa,
    areaIncraHa,
    diferencaHa,
    diferencaPct,
    alertaDiscrepancia,
    sobreposicaoGeometrica,
    fonte: 'Comparativo SICAR vs SIGEF/INCRA' + (sobreposicaoGeometrica ? ' (sobreposição geométrica via PostGIS)' : ''),
    consultadoEm: new Date().toISOString(),
  };
}

export async function consultarSicorTitular(
  cpfCnpj: string,
  _codigoIbge?: string
): Promise<SicorTitularResult | null> {
  const doc = cpfCnpj.replace(/\D/g, '');
  if (!doc || (doc.length !== 11 && doc.length !== 14)) return null;

  console.log('[SICOR] Consulta por CPF/CNPJ indisponível — API pública BCB/SICOR não suporta filtro por titular individual; requer convênio com Banco Central');
  return null;
}

export async function consultarItrVtn(
  codigoIncra: string,
  _cpfCnpj?: string
): Promise<ItrVtnResult | null> {
  const cacheKey = `itr_vtn:${codigoIncra}`;
  const cached = await getCached<ItrVtnResult>('due_diligence', cacheKey);
  if (cached) return cached;

  try {
    const result: ItrVtnResult = {
      nirf: codigoIncra,
      vtn: null,
      vtnPorHa: null,
      areaDeclarada: null,
      aliquota: null,
      fonte: 'VTN por propriedade disponível apenas via CAFIR/Receita Federal (requer certificado digital)',
      consultadoEm: new Date().toISOString(),
    };

    return result;
  } catch (err) {
    console.error('[ITR/VTN] Erro:', (err as Error).message);
    return null;
  }
}

export function calcularScoreRiscoFundiario(
  prodes: ProdesResult | null,
  sobreposicoes: SobreposicaoResult | null,
  carVsIncra: CarVsIncraResult | null,
  sicor: SicorTitularResult | null,
  itrVtn: ItrVtnResult | null
): { score: number; breakdown: DueDiligenceFundiariaResult['scoreBreakdown'] } {
  let ambiental = 100;
  if (prodes) {
    if (prodes.totalAreaHa > 100) ambiental -= 40;
    else if (prodes.totalAreaHa > 50) ambiental -= 25;
    else if (prodes.totalAreaHa > 10) ambiental -= 15;
    else if (prodes.totalAreaHa > 0) ambiental -= 5;

    const recentYears = prodes.porAno.filter(p => p.ano >= new Date().getFullYear() - 5);
    if (recentYears.length > 0) {
      const recentArea = recentYears.reduce((s, p) => s + p.areaHa, 0);
      if (recentArea > 10) ambiental -= 20;
      else if (recentArea > 0) ambiental -= 10;
    }
  }
  ambiental = Math.max(0, ambiental);

  let juridico = 100;
  if (sobreposicoes) {
    if (sobreposicoes.terrasIndigenas.length > 0) juridico -= 50;
    if (sobreposicoes.quilombolas.length > 0) juridico -= 40;
    if ((sobreposicoes.assentamentos || []).length > 0) juridico -= 40;
    for (const uc of sobreposicoes.unidadesConservacao) {
      juridico -= uc.nivelRisco === 'alto' ? 30 : 15;
    }
  }
  juridico = Math.max(0, juridico);

  let documental = 100;
  if (carVsIncra) {
    if (carVsIncra.alertaDiscrepancia) {
      const absPct = Math.abs(carVsIncra.diferencaPct || 0);
      if (absPct > 20) documental -= 40;
      else if (absPct > 10) documental -= 25;
      else documental -= 10;
    }
    if (carVsIncra.areaCarHa === null || carVsIncra.areaIncraHa === null) {
      documental -= 15;
    }
    if (carVsIncra.sobreposicaoGeometrica) {
      if (!carVsIncra.sobreposicaoGeometrica.carCobreIncra) {
        const overlapPct = carVsIncra.sobreposicaoGeometrica.percentualSobreposicao;
        // null = valor reprovado na sanidade ("a verificar") — cobertura
        // desconhecida recebe penalidade intermediária, nunca é tratada como boa
        if (overlapPct == null) documental -= 15;
        else if (overlapPct < 50) documental -= 30;
        else if (overlapPct < 80) documental -= 15;
        else if (overlapPct < 95) documental -= 5;
      }
    }
  } else {
    documental -= 20;
  }
  documental = Math.max(0, documental);

  let financeiro = 100;
  if (sicor) {
    if (sicor.temHipotecaAtiva) financeiro -= 25;
    if (sicor.valorTotal > 5000000) financeiro -= 15;
    else if (sicor.valorTotal > 1000000) financeiro -= 10;
  }
  financeiro = Math.max(0, financeiro);

  let valuation = 100;
  if (itrVtn) {
    if (itrVtn.vtn === null) valuation -= 30;
  } else {
    valuation -= 30;
  }
  valuation = Math.max(0, valuation);

  const weights = { ambiental: 0.3, juridico: 0.25, documental: 0.2, financeiro: 0.15, valuation: 0.1 };
  const score = Math.round(
    ambiental * weights.ambiental +
    juridico * weights.juridico +
    documental * weights.documental +
    financeiro * weights.financeiro +
    valuation * weights.valuation
  );

  return {
    score,
    breakdown: {
      ambiental: Math.round(ambiental),
      juridico: Math.round(juridico),
      documental: Math.round(documental),
      financeiro: Math.round(financeiro),
      valuation: Math.round(valuation),
    },
  };
}

interface AssetSpatialData {
  polygon: any;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  centroid: { lat: number; lon: number };
  areaHa: number;
}

async function fetchAssetSpatialData(assetId: number): Promise<AssetSpatialData | null> {
  try {
    const rows = await db.execute(sql`
      SELECT
        ST_AsGeoJSON(geom) as geojson,
        ST_XMin(geom) as xmin, ST_YMin(geom) as ymin,
        ST_XMax(geom) as xmax, ST_YMax(geom) as ymax,
        ST_X(ST_Centroid(geom)) as cx, ST_Y(ST_Centroid(geom)) as cy,
        ROUND(CAST(ST_Area(ST_Transform(geom, ${sql.raw(utmSridSqlExpr("geom"))})) / 10000 AS numeric), 2) as area_ha
      FROM assets
      WHERE id = ${assetId} AND geom IS NOT NULL
    `);
    const row = (rows as any).rows?.[0];
    if (row?.geojson) {
      return {
        polygon: JSON.parse(row.geojson),
        bbox: {
          minLon: Number(row.xmin),
          minLat: Number(row.ymin),
          maxLon: Number(row.xmax),
          maxLat: Number(row.ymax),
        },
        centroid: { lat: Number(row.cy), lon: Number(row.cx) },
        areaHa: Number(row.area_ha) || 0,
      };
    }
  } catch (err) {
    console.warn('[DD] Erro ao buscar polígono do ativo:', (err as Error).message);
  }
  return null;
}

export async function computePostGISIntersection(
  assetId: number,
  featureGeoJson: any,
  referenceGeoJson?: any
): Promise<{ intersectionAreaHa: number; overlapPercent: number; aVerificar?: string }> {
  // sanidade do percentual: > 100 (além da tolerância) devolve aVerificar —
  // números zerados + motivo, para o consumidor exibir o marcador
  const checarRow = (row: any): { intersectionAreaHa: number; overlapPercent: number; aVerificar?: string } => {
    const inter = Number(row.intersection_ha) || 0;
    const pctC = checarPercentual(Number(row.overlap_pct) || 0, 'sobreposição × área de referência (PostGIS)');
    return pctC.ok
      ? { intersectionAreaHa: inter, overlapPercent: pctC.valor }
      : { intersectionAreaHa: 0, overlapPercent: 0, aVerificar: pctC.motivo };
  };
  try {
    const featureStr = JSON.stringify(featureGeoJson);

    if (referenceGeoJson) {
      const refStr = JSON.stringify(referenceGeoJson);
      const rows = await db.execute(sql`
        WITH ref AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(${refStr}), 4326) as geom
        ),
        srid AS (
          SELECT ${sql.raw(utmSridSqlExpr("(SELECT geom FROM ref)"))} AS s
        )
        SELECT
          ROUND(CAST(
            ST_Area(ST_Intersection(
              ST_Transform((SELECT geom FROM ref), (SELECT s FROM srid)),
              ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326), (SELECT s FROM srid))
            )) / 10000 AS numeric
          ), 2) as intersection_ha,
          CASE WHEN ST_Area(ST_Transform((SELECT geom FROM ref), (SELECT s FROM srid))) > 0
            THEN ROUND(CAST(
              ST_Area(ST_Intersection(
                ST_Transform((SELECT geom FROM ref), (SELECT s FROM srid)),
                ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326), (SELECT s FROM srid))
              )) / ST_Area(ST_Transform((SELECT geom FROM ref), (SELECT s FROM srid))) * 100 AS numeric
            ), 1)
            ELSE 0
          END as overlap_pct
        WHERE ST_Intersects(
          (SELECT geom FROM ref),
          ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326)
        )
      `);
      const row = (rows as any).rows?.[0];
      if (row) return checarRow(row);
    } else {
      const rows = await db.execute(sql`
        SELECT
          ROUND(CAST(
            ST_Area(ST_Intersection(
              ST_Transform(a.geom, ${sql.raw(utmSridSqlExpr("a.geom"))}),
              ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326), ${sql.raw(utmSridSqlExpr("a.geom"))})
            )) / 10000 AS numeric
          ), 2) as intersection_ha,
          CASE WHEN ST_Area(ST_Transform(a.geom, ${sql.raw(utmSridSqlExpr("a.geom"))})) > 0
            THEN ROUND(CAST(
              ST_Area(ST_Intersection(
                ST_Transform(a.geom, ${sql.raw(utmSridSqlExpr("a.geom"))}),
                ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326), ${sql.raw(utmSridSqlExpr("a.geom"))})
              )) / ST_Area(ST_Transform(a.geom, ${sql.raw(utmSridSqlExpr("a.geom"))})) * 100 AS numeric
            ), 1)
            ELSE 0
          END as overlap_pct
        FROM assets a
        WHERE a.id = ${assetId} AND a.geom IS NOT NULL
          AND ST_Intersects(a.geom, ST_SetSRID(ST_GeomFromGeoJSON(${featureStr}), 4326))
      `);
      const row = (rows as any).rows?.[0];
      if (row) return checarRow(row);
    }
  } catch (err) {
    // Antes o erro virava "0 ha de interseção" (= sem sobreposição). Agora propaga: os chamadores
    // marcam "a verificar" em vez de tratar falha de cálculo como ausência.
    console.warn('[DD PostGIS] Intersection error:', (err as Error).message);
    throw err;
  }
  return { intersectionAreaHa: 0, overlapPercent: 0 };
}

export async function executarDueDiligenceFundiaria(params: {
  codigoIncra: string;
  cpfCnpj?: string;
  lat?: number;
  lon?: number;
  areaIncraHa?: number;
  areaCarHa?: number;
  codigoCar?: string;
  codigoIbge?: string;
  assetId?: number;
}): Promise<DueDiligenceFundiariaResult> {
  const { codigoIncra, cpfCnpj, areaCarHa, codigoCar, codigoIbge, assetId } = params;
  let { lat, lon, areaIncraHa } = params;

  const status: Record<string, 'sucesso' | 'erro' | 'indisponivel' | 'pendente'> = {
    prodes: 'pendente',
    sobreposicoes: 'pendente',
    carVsIncra: 'pendente',
    sicor: 'pendente',
    itrVtn: 'pendente',
  };

  const sigefResult = await fetchSigefPolygon(codigoIncra);
  let sigefPolygon: any = sigefResult?.polygon || null;
  let sigefFonte: string | null = sigefResult?.fonte || null;

  let assetSpatial: AssetSpatialData | null = null;
  if (assetId) {
    assetSpatial = await fetchAssetSpatialData(assetId);
  }

  if (sigefPolygon) {
    try {
      const sigefStr = JSON.stringify(sigefPolygon);
      const bboxRows = await db.execute(sql`
        SELECT
          ST_XMin(g) as xmin, ST_YMin(g) as ymin,
          ST_XMax(g) as xmax, ST_YMax(g) as ymax,
          ST_X(ST_Centroid(g)) as cx, ST_Y(ST_Centroid(g)) as cy,
          ROUND(CAST(ST_Area(ST_Transform(g, ${sql.raw(utmSridSqlExpr("g"))})) / 10000 AS numeric), 2) as area_ha
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${sigefStr}), 4326) as g) t
      `);
      const br = (bboxRows as any).rows?.[0];
      if (br) {
        if (lat === undefined || lon === undefined) {
          lat = Number(br.cy);
          lon = Number(br.cx);
        }
        if (Number(br.area_ha) > 0) {
          areaIncraHa = Number(br.area_ha);
        }
        if (!assetSpatial) {
          assetSpatial = {
            polygon: sigefPolygon,
            bbox: {
              minLon: Number(br.xmin), minLat: Number(br.ymin),
              maxLon: Number(br.xmax), maxLat: Number(br.ymax),
            },
            centroid: { lat: Number(br.cy), lon: Number(br.cx) },
            areaHa: Number(br.area_ha) || 0,
          };
        }
      }
    } catch (err) {
      console.warn('[DD] Erro ao calcular bbox do SIGEF:', (err as Error).message);
    }
  }

  if (assetSpatial) {
    if (lat === undefined || lon === undefined) {
      lat = assetSpatial.centroid.lat;
      lon = assetSpatial.centroid.lon;
    }
    if (!areaIncraHa && assetSpatial.areaHa > 0) {
      areaIncraHa = assetSpatial.areaHa;
    }
  }

  if (lat === undefined || lon === undefined) {
    throw new Error('Coordenadas não disponíveis — SIGEF indisponível e ativo sem polígono/lat/lon');
  }

  const polygonBbox = assetSpatial?.bbox || undefined;

  const [prodesResult, sobreposicoesResult, sicorResult, itrVtnResult] = await Promise.allSettled([
    consultarProdesHistorico(lat, lon, 0.15, polygonBbox),
    consultarSobreposicoes(lat, lon, areaIncraHa || null, 0.15, polygonBbox),
    cpfCnpj ? consultarSicorTitular(cpfCnpj, codigoIbge) : Promise.resolve(null),
    consultarItrVtn(codigoIncra, cpfCnpj),
  ]);

  const prodes = prodesResult.status === 'fulfilled' ? prodesResult.value : null;
  status.prodes = prodes ? 'sucesso' : (prodesResult.status === 'rejected' ? 'erro' : 'indisponivel');

  const sobreposicoes = sobreposicoesResult.status === 'fulfilled' ? sobreposicoesResult.value : null;
  status.sobreposicoes = sobreposicoes ? 'sucesso' : (sobreposicoesResult.status === 'rejected' ? 'erro' : 'indisponivel');

  const refGeom = sigefPolygon || assetSpatial?.polygon || null;
  if ((assetId || refGeom) && sobreposicoes) {
    const geoFeatures = sobreposicoes.geoJsonFeatures || [];

    // Para cada lista, calcula a interseção real (PostGIS). Áreas sem geometria, ou cujo cálculo
    // falhou, NÃO são descartadas: ficam marcadas "a verificar" (descartar escondia possível sobreposição).
    const processarLista = async (lista: SobreposicaoArea[]): Promise<{ area: SobreposicaoArea; feat: any }[]> => {
      const out: { area: SobreposicaoArea; feat: any }[] = [];
      for (const area of lista) {
        const feat = geoFeatures.find((f: any) => f?.properties?.featKey === area.featKey);
        if (!feat?.geometry) {
          area.aVerificar = 'geometria indisponível — interseção não calculada (proximidade apenas)';
          out.push({ area, feat: null });
          continue;
        }
        try {
          const r = await computePostGISIntersection(assetId || 0, feat.geometry, refGeom || undefined);
          if (r.intersectionAreaHa > 0 || r.overlapPercent > 0 || r.aVerificar) {
            area.areaIntersecaoHa = r.intersectionAreaHa;
            area.percentualSobreposicao = r.overlapPercent;
            if (r.aVerificar) area.aVerificar = r.aVerificar;
            out.push({ area, feat });
          }
        } catch {
          area.aVerificar = 'cálculo de interseção falhou — verificar manualmente';
          out.push({ area, feat });
        }
      }
      return out;
    };
    const tiWithIntersection = await processarLista(sobreposicoes.terrasIndigenas);
    const quilWithIntersection = await processarLista(sobreposicoes.quilombolas);
    const ucWithIntersection = await processarLista(sobreposicoes.unidadesConservacao);
    const asWithIntersection = await processarLista(sobreposicoes.assentamentos || []);

    sobreposicoes.terrasIndigenas = tiWithIntersection.map(x => x.area);
    sobreposicoes.quilombolas = quilWithIntersection.map(x => x.area);
    sobreposicoes.unidadesConservacao = ucWithIntersection.map(x => x.area);
    sobreposicoes.assentamentos = asWithIntersection.map(x => x.area);
    sobreposicoes.geoJsonFeatures = [
      ...tiWithIntersection, ...quilWithIntersection, ...ucWithIntersection, ...asWithIntersection,
    ].map(x => x.feat).filter(Boolean);
    sobreposicoes.totalSobreposicoes =
      sobreposicoes.terrasIndigenas.length + sobreposicoes.quilombolas.length +
      sobreposicoes.unidadesConservacao.length + sobreposicoes.assentamentos.length;
    sobreposicoes.riscoMaximo = calcularRiscoSobreposicao(sobreposicoes);
    sobreposicoes.fonte = `${sobreposicoes.fonte} — interseção calculada via PostGIS`;
  }

  if ((assetId || refGeom) && prodes) {
    if (prodes.geoJsonFeatures?.length) {
      let totalIntersectionHa = 0;
      const intersectingFeatures: any[] = [];
      const porAnoMap = new Map<number, { areaHa: number; count: number }>();

      for (const feat of prodes.geoJsonFeatures) {
        if (feat?.geometry) {
          try {
            const { intersectionAreaHa } = await computePostGISIntersection(assetId || 0, feat.geometry, refGeom || undefined);
            if (intersectionAreaHa > 0) {
              totalIntersectionHa += intersectionAreaHa;
              intersectingFeatures.push(feat);
              const ano = feat.properties?.ano || 0;
              if (ano) {
                const existing = porAnoMap.get(ano) || { areaHa: 0, count: 0 };
                existing.areaHa += intersectionAreaHa;
                existing.count += 1;
                porAnoMap.set(ano, existing);
              }
            }
          } catch {}
        }
      }

      prodes.totalAreaHa = Math.round(totalIntersectionHa * 100) / 100;
      prodes.poligonos = intersectingFeatures.length;
      prodes.geoJsonFeatures = intersectingFeatures;
      prodes.porAno = Array.from(porAnoMap.entries())
        .map(([ano, data]) => ({ ano, areaHa: Math.round(data.areaHa * 100) / 100, count: data.count }))
        .sort((a, b) => a.ano - b.ano);
      prodes.fonte = 'PRODES/INPE — área de interseção com polígono do ativo via PostGIS';
    } else {
      prodes.totalAreaHa = 0;
      prodes.poligonos = 0;
      prodes.porAno = [];
      prodes.fonte = 'PRODES/INPE — nenhum polígono de desmatamento encontrado na região';
    }
  }

  const masterGeometry = sigefPolygon || assetSpatial?.polygon || null;
  const carVsIncra = await compararCarVsIncra(areaCarHa || null, areaIncraHa || null, assetId, codigoCar, polygonBbox, masterGeometry);
  status.carVsIncra = 'sucesso';

  const sicor = sicorResult.status === 'fulfilled' ? sicorResult.value : null;
  if (!cpfCnpj) {
    status.sicor = 'indisponivel';
  } else if (sicor) {
    status.sicor = 'sucesso';
  } else {
    status.sicor = 'indisponivel';
  }

  const itrVtn = itrVtnResult.status === 'fulfilled' ? itrVtnResult.value : null;
  status.itrVtn = itrVtn ? 'sucesso' : 'indisponivel';

  const { score, breakdown } = calcularScoreRiscoFundiario(prodes, sobreposicoes, carVsIncra, sicor, itrVtn);

  const prodesGeo = prodes?.geoJsonFeatures?.length
    ? { type: 'FeatureCollection', features: prodes.geoJsonFeatures }
    : null;
  const sobreposicoesGeo = sobreposicoes?.geoJsonFeatures?.length
    ? { type: 'FeatureCollection', features: sobreposicoes.geoJsonFeatures }
    : null;

  return {
    codigoIncra,
    cpfCnpj,
    prodes,
    sobreposicoes,
    carVsIncra,
    sicor,
    itrVtn,
    scoreRiscoFundiario: score,
    scoreBreakdown: breakdown,
    geoLayers: {
      prodesFeatures: prodesGeo,
      sobreposicoesFeatures: sobreposicoesGeo,
      assetPoint: { lat, lon },
      sigefPolygon: sigefPolygon
        ? { type: 'Feature', geometry: sigefPolygon, properties: { layer: 'sigef', fonte: sigefFonte } }
        : null,
      assetPolygon: assetSpatial?.polygon ? { type: 'Feature', geometry: assetSpatial.polygon, properties: { layer: 'asset' } } : null,
      carPolygon: carVsIncra?.sobreposicaoGeometrica?.carPolygonGeoJson
        ? { type: 'Feature', geometry: carVsIncra.sobreposicaoGeometrica.carPolygonGeoJson, properties: { layer: 'car' } }
        : null,
      carIncraIntersection: carVsIncra?.sobreposicaoGeometrica?.geoJsonIntersecao
        ? { type: 'Feature', geometry: carVsIncra.sobreposicaoGeometrica.geoJsonIntersecao, properties: { layer: 'car-incra-intersection' } }
        : null,
    },
    consultadoEm: new Date().toISOString(),
    status,
  };
}
