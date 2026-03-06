import axios from 'axios';

export interface SoilGridsResult {
  phh2o: number | null;
  clay: number | null;
  sand: number | null;
  soc: number | null;
  nitrogen: number | null;
  cec: number | null;
  wv0033: number | null;
  wv1500: number | null;
  soilClass: string | null;
}

export async function consultarSoloSoilGrids(lat: number, lon: number): Promise<SoilGridsResult> {
  try {
    const properties = ['phh2o', 'clay', 'sand', 'soc', 'nitrogen', 'cec', 'wv0033', 'wv1500'];
    const params = new URLSearchParams();
    params.append('lon', lon.toString());
    params.append('lat', lat.toString());
    params.append('depth', '0-5cm');
    params.append('value', 'mean');
    properties.forEach(p => params.append('property', p));

    const [propertiesRes, classRes] = await Promise.allSettled([
      axios.get(`https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`, { timeout: 15000 }),
      axios.get(`https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${lon}&lat=${lat}&number_classes=1`, { timeout: 15000 })
    ]);

    const result: SoilGridsResult = {
      phh2o: null, clay: null, sand: null, soc: null,
      nitrogen: null, cec: null, wv0033: null, wv1500: null, soilClass: null
    };

    if (propertiesRes.status === 'fulfilled') {
      const layers = propertiesRes.value.data?.properties?.layers || [];
      for (const layer of layers) {
        const name = layer.name as keyof SoilGridsResult;
        const mean = layer.depths?.[0]?.values?.mean;
        if (mean !== undefined && mean !== null) {
          const conversionFactors: Record<string, number> = {
            phh2o: 0.1,
            clay: 0.1,
            sand: 0.1,
            soc: 0.1,
            nitrogen: 0.01,
            cec: 0.1,
            wv0033: 0.1,
            wv1500: 0.1,
          };
          const factor = conversionFactors[layer.name] ?? 1;
          (result as any)[name] = parseFloat((mean * factor).toFixed(2));
        }
      }
    }

    if (classRes.status === 'fulfilled') {
      result.soilClass = classRes.value.data?.wrb_class_name || null;
    }

    return result;
  } catch (err) {
    console.error('[SoilGrids] Erro:', err);
    return {
      phh2o: null, clay: null, sand: null, soc: null,
      nitrogen: null, cec: null, wv0033: null, wv1500: null, soilClass: null
    };
  }
}

let embrapaToken: string | null = null;
let embrapaTokenExpiry = 0;

async function getEmbrapaToken(): Promise<string | null> {
  const clientId = process.env.EMBRAPA_CONSUMER_KEY || process.env.EMBRAPA_CLIENT_ID;
  const clientSecret = process.env.EMBRAPA_CONSUMER_SECRET || process.env.EMBRAPA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (embrapaToken && Date.now() < embrapaTokenExpiry) return embrapaToken;

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await axios.post(
      'https://api.cnptia.embrapa.br/token',
      'grant_type=client_credentials',
      { headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
    );
    embrapaToken = res.data.access_token;
    embrapaTokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return embrapaToken;
  } catch (err) {
    console.error('[Embrapa] Erro ao obter token:', err);
    return null;
  }
}

export interface ZarcResult {
  cultura: string;
  municipio: string;
  aptidao: 'Apto' | 'Inapto' | 'Apto com Restrição' | null;
  riscoCli: string | null;
  datasPlantio: string[];
}

export interface CultivaresResult {
  cultura: string;
  cultivares: Array<{ nome: string; ciclo?: string; produtividade?: string }>;
}

export interface ProdutividadeResult {
  cultura: string;
  estimativa: number | null;
  unidade: string;
}

const CULTURA_IDS: Record<string, number> = {
  soja: 60, milho: 56, 'milho 2a safra': 57, feijao: 51, arroz: 1,
  trigo: 32533, algodao: 2, amendoim: 81, cevada: 91, girassol: 121,
  mamona: 131, sorgo: 32, 'feijao caupi': 141,
};

let _culturasCache: Record<string, number> | null = null;
let _culturasCacheExpiry = 0;

async function getCulturaId(token: string, cultura: string): Promise<number | null> {
  const culturaLower = cultura.toLowerCase().trim();
  const staticId = CULTURA_IDS[culturaLower];
  if (staticId) return staticId;

  if (_culturasCache && Date.now() < _culturasCacheExpiry) {
    return _culturasCache[culturaLower] || null;
  }

  try {
    const res = await axios.get('https://api.cnptia.embrapa.br/agritec/v2/culturas', {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
    });
    const raw = res.data?.data || res.data || [];
    const culturas = Array.isArray(raw) ? raw : [];
    _culturasCache = {};
    for (const c of culturas) {
      const nome = c.nome || c.nomeCompleto || '';
      if (nome && c.id) {
        _culturasCache[nome.toLowerCase().trim()] = c.id;
      }
    }
    _culturasCacheExpiry = Date.now() + 3600000;
    return _culturasCache[culturaLower] || null;
  } catch {
    return null;
  }
}

export async function consultarZARC(codIBGE: string, cultura: string): Promise<ZarcResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  try {
    const idCultura = await getCulturaId(token, cultura);
    if (!idCultura) {
      console.warn(`[Embrapa ZARC] Cultura "${cultura}" não encontrada no catálogo`);
      return null;
    }

    const params = new URLSearchParams({
      idCultura: String(idCultura),
      codigoIBGE: codIBGE,
      risco: '20',
    });
    const res = await axios.get(
      `https://api.cnptia.embrapa.br/agritec/v2/zoneamento?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const raw = res.data?.data || res.data;
    const data = Array.isArray(raw) ? raw : [raw];

    const datasPlantio: string[] = [];
    let aptidao: 'Apto' | 'Inapto' | 'Apto com Restrição' | null = null;

    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    for (const item of data) {
      if (item.diaIni && item.mesIni && item.diaFim && item.mesFim) {
        const label = `${item.diaIni}/${meses[item.mesIni-1]} a ${item.diaFim}/${meses[item.mesFim-1]} (${item.ciclo || ''} ${item.solo || ''})`.trim();
        datasPlantio.push(label);
      }
      if (item.safra) {
        aptidao = 'Apto';
      }
    }

    if (data.length > 0) aptidao = aptidao || 'Apto';

    return {
      cultura,
      municipio: data[0]?.municipio || '',
      aptidao,
      riscoCli: params.get('risco') ? `${params.get('risco')}%` : null,
      datasPlantio: datasPlantio.slice(0, 6),
    };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      console.warn(`[Embrapa ZARC] Sem dados para ${cultura}/${codIBGE}`);
    } else {
      console.warn(`[Embrapa ZARC] ${status || 'erro'} para ${cultura}/${codIBGE}:`, err?.response?.data?.message || err.message);
    }
    return null;
  }
}

async function getUfFromIBGE(codIBGE: string, token: string): Promise<string | null> {
  try {
    const res = await axios.get(`https://api.cnptia.embrapa.br/agritec/v2/municipios/${codIBGE}`, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
    });
    return res.data?.uf || res.data?.siglaUf || null;
  } catch {
    const ufMap: Record<string, string> = {
      '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
      '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL',
      '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
      '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
    };
    return ufMap[codIBGE.substring(0, 2)] || null;
  }
}

function getCurrentSafra(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

export async function consultarCultivares(codIBGE: string, cultura: string): Promise<CultivaresResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  try {
    const idCultura = await getCulturaId(token, cultura);
    if (!idCultura) return null;

    const uf = await getUfFromIBGE(codIBGE, token);
    if (!uf) return null;

    const safra = getCurrentSafra();
    const params = new URLSearchParams({
      safra,
      idCultura: String(idCultura),
      uf,
    });
    const res = await axios.get(
      `https://api.cnptia.embrapa.br/agritec/v2/cultivares?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const raw = res.data?.data || res.data;
    const items = Array.isArray(raw) ? raw : [];
    return {
      cultura,
      cultivares: items.slice(0, 20).map((c: any) => ({
        nome: c.nome || c.cultivar || c.nomeComum || '',
        ciclo: c.ciclo || c.grupoCiclo || '',
        produtividade: c.produtividadeMedia ? `${c.produtividadeMedia} sc/ha` : '',
      })),
    };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 404) console.warn(`[Embrapa Cultivares] ${status || 'erro'} para ${cultura}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

export async function consultarProdutividade(codIBGE: string, cultura: string): Promise<ProdutividadeResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  try {
    const idCultura = await getCulturaId(token, cultura);
    if (!idCultura) return null;

    const now = new Date();
    const dataPlantio = `${now.getFullYear()}-01-15`;

    const params = new URLSearchParams({
      idCultura: String(idCultura),
      idCultivar: '0',
      codigoIBGE: codIBGE,
      cad: '75',
      dataPlantio,
      expectativaProdutividade: '60',
    });
    const res = await axios.get(
      `https://api.cnptia.embrapa.br/agritec/v2/produtividade?${params}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const data = res.data;
    return {
      cultura,
      estimativa: data?.produtividadeMedia || data?.produtividade || data?.valor || null,
      unidade: data?.unidade || 'sc/ha',
    };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 404) console.warn(`[Embrapa Produtividade] ${status || 'erro'} para ${cultura}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

export interface SigefParcela {
  codigo: string;
  area: number;
  municipio: string;
  uf: string;
  situacao: string;
  matricula?: string;
  cartorio?: string;
  dataRegistro?: string;
}

export interface SigefParcelaDetalhe extends SigefParcela {
  vertices: Array<{ lat: number; lon: number }>;
  centroide?: { lat: number; lon: number };
}

export async function consultarParcelasSIGEF(cnpj: string): Promise<SigefParcela[]> {
  const apiKey = process.env.INFOSIMPLES_API_KEY;
  if (!apiKey) {
    console.warn('[SIGEF] INFOSIMPLES_API_KEY não configurada');
    return [];
  }

  try {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const res = await axios.post(
      'https://api.infosimples.com/api/v2/consultas/incra/sigef/parcelas',
      { cnpj: cnpjLimpo, token: apiKey },
      { timeout: 30000 }
    );

    const parcelas = res.data?.data || [];
    return parcelas.map((p: any) => ({
      codigo: p.codigo || p.code || '',
      area: parseFloat(p.area_ha || p.area || 0),
      municipio: p.municipio || '',
      uf: p.uf || p.estado || '',
      situacao: p.situacao || p.status || '',
      matricula: p.matricula || '',
      cartorio: p.cartorio || '',
      dataRegistro: p.data_registro || '',
    }));
  } catch (err) {
    console.error('[SIGEF] Erro ao consultar parcelas:', err);
    return [];
  }
}

export async function consultarDetalhesParcela(codigoParcela: string): Promise<SigefParcelaDetalhe | null> {
  const apiKey = process.env.INFOSIMPLES_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      'https://api.infosimples.com/api/v2/consultas/incra/sigef/parcela/detalhes',
      { codigo: codigoParcela, token: apiKey },
      { timeout: 30000 }
    );

    const data = res.data?.data?.[0] || {};
    const verticesRaw = data.vertices || data.pontos || [];
    const vertices = verticesRaw.map((v: any) => ({
      lat: parseFloat(v.lat || v.latitude || 0),
      lon: parseFloat(v.lon || v.longitude || 0),
    }));

    let centroide = undefined;
    if (vertices.length > 0) {
      const avgLat = vertices.reduce((s: number, v: any) => s + v.lat, 0) / vertices.length;
      const avgLon = vertices.reduce((s: number, v: any) => s + v.lon, 0) / vertices.length;
      centroide = { lat: avgLat, lon: avgLon };
    }

    return {
      codigo: codigoParcela,
      area: parseFloat(data.area_ha || 0),
      municipio: data.municipio || '',
      uf: data.uf || '',
      situacao: data.situacao || '',
      matricula: data.matricula || '',
      cartorio: data.cartorio || '',
      dataRegistro: data.data_registro || '',
      vertices,
      centroide,
    };
  } catch (err) {
    console.error('[SIGEF] Erro ao consultar detalhes:', err);
    return null;
  }
}

export interface ClimaResult {
  precipitacaoMedia: number;
  temperaturaMaxMedia: number;
  temperaturaMinMedia: number;
  fonte: string;
}

export async function consultarClimaEmbrapa(lat: number, lon: number): Promise<ClimaResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  try {
    const ontem = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const [precRes, tmaxRes, tminRes] = await Promise.allSettled([
      axios.get(`https://api.cnptia.embrapa.br/climapi/v1/ncep-gfs/apcpsfc/${ontem}/${lon}/${lat}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }),
      axios.get(`https://api.cnptia.embrapa.br/climapi/v1/ncep-gfs/tmax2m/${ontem}/${lon}/${lat}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }),
      axios.get(`https://api.cnptia.embrapa.br/climapi/v1/ncep-gfs/tmin2m/${ontem}/${lon}/${lat}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }),
    ]);

    const avg = (arr: any[]) => {
      const vals = arr.filter((v: any) => v.valor != null).map((v: any) => v.valor);
      return vals.length > 0 ? parseFloat((vals.reduce((a: number, b: number) => a + b, 0) / vals.length).toFixed(1)) : 0;
    };

    const precip = precRes.status === 'fulfilled' ? avg(precRes.value.data || []) : 0;
    const tmax = tmaxRes.status === 'fulfilled' ? avg(tmaxRes.value.data || []) : 0;
    const tmin = tminRes.status === 'fulfilled' ? avg(tminRes.value.data || []) : 0;

    return { precipitacaoMedia: precip, temperaturaMaxMedia: tmax, temperaturaMinMedia: tmin, fonte: 'Embrapa ClimAPI/NCEP-GFS' };
  } catch (err) {
    console.error('[Embrapa ClimAPI] Erro:', err);
    return null;
  }
}

export interface SATVegNDVIResult {
  ndviMedio: number;
  eviMedio: number;
  dataInicio: string;
  dataFim: string;
  pontos: number;
  fonte: string;
}

export async function consultarNDVISATVeg(lat: number, lon: number): Promise<SATVegNDVIResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  try {
    const now = new Date();
    const dataFim = now.toISOString().split('T')[0];
    const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000);
    const dataInicio = sixMonthsAgo.toISOString().split('T')[0];

    const [ndviRes, eviRes] = await Promise.allSettled([
      axios.post(
        'https://api.cnptia.embrapa.br/satveg/v2/series',
        { longitude: lon, latitude: lat, dataInicial: dataInicio, dataFinal: dataFim, satelite: 'terra', tipoPerfil: 'ndvi' },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      ),
      axios.post(
        'https://api.cnptia.embrapa.br/satveg/v2/series',
        { longitude: lon, latitude: lat, dataInicial: dataInicio, dataFinal: dataFim, satelite: 'terra', tipoPerfil: 'evi' },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      ),
    ]);

    const extractSeries = (res: PromiseSettledResult<any>): number[] => {
      if (res.status !== 'fulfilled') return [];
      const d = res.value.data;
      const raw = d?.listaSerie || d?.data?.listaSerie || d?.data || [];
      if (!Array.isArray(raw)) return [];
      return raw.map((v: any) => typeof v === 'number' ? v : v?.valor ?? NaN).filter((v: number) => !isNaN(v));
    };
    const ndviData = extractSeries(ndviRes);
    const eviData = extractSeries(eviRes);

    if (ndviData.length === 0 && eviData.length === 0) return null;

    const avg = (arr: number[]) => arr.length > 0 ? parseFloat((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(4)) : 0;

    return {
      ndviMedio: avg(ndviData),
      eviMedio: avg(eviData),
      dataInicio,
      dataFim,
      pontos: Math.max(ndviData.length, eviData.length),
      fonte: 'Embrapa SATVeg/MODIS',
    };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 404) console.warn(`[SATVeg] ${status || 'erro'}:`, err?.response?.data?.message || err.message);
    return null;
  }
}

export interface NDVIGridPoint {
  lat: number;
  lon: number;
  ndviAtual: number;
  ndviMedio: number;
}

export interface ZonaManejo {
  nome: string;
  classificacao: 'alta' | 'media' | 'baixa' | 'critica';
  cor: string;
  pontos: NDVIGridPoint[];
  ndviMedio: number;
  percentual: number;
}

export interface NDVIGridResult {
  points: NDVIGridPoint[];
  stats: {
    min: number;
    max: number;
    media: number;
    desvio: number;
    cv: number;
    uniformidade: number;
  };
  zonas: ZonaManejo[];
  alertas: string[];
  diagnostico: string;
  bbox: [number, number, number, number];
  timestamp: string;
}

function gerarGridDentroPoligono(
  polygon: number[][],
  gridSize: number
): { lat: number; lon: number }[] {
  const lats = polygon.map(c => c[1]);
  const lons = polygon.map(c => c[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const stepLat = (maxLat - minLat) / (gridSize + 1);
  const stepLon = (maxLon - minLon) / (gridSize + 1);

  const points: { lat: number; lon: number }[] = [];
  for (let i = 1; i <= gridSize; i++) {
    for (let j = 1; j <= gridSize; j++) {
      const lat = minLat + stepLat * i;
      const lon = minLon + stepLon * j;
      if (pontoDentroPoligono(lon, lat, polygon)) {
        points.push({ lat: parseFloat(lat.toFixed(6)), lon: parseFloat(lon.toFixed(6)) });
      }
    }
  }

  if (points.length === 0) {
    const centLat = (minLat + maxLat) / 2;
    const centLon = (minLon + maxLon) / 2;
    points.push({ lat: parseFloat(centLat.toFixed(6)), lon: parseFloat(centLon.toFixed(6)) });
  }

  return points;
}

function pontoDentroPoligono(x: number, y: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

async function consultarNDVIPonto(token: string, lat: number, lon: number): Promise<{ ndviAtual: number; ndviMedio: number } | null> {
  try {
    const now = new Date();
    const dataFim = now.toISOString().split('T')[0];
    const tresM = new Date(now.getTime() - 90 * 86400000);
    const dataInicio = tresM.toISOString().split('T')[0];

    const res = await axios.post(
      'https://api.cnptia.embrapa.br/satveg/v2/series',
      { longitude: lon, latitude: lat, dataInicial: dataInicio, dataFinal: dataFim, satelite: 'terra', tipoPerfil: 'ndvi' },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const raw = res.data?.listaSerie || res.data?.data?.listaSerie || [];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const series = raw.map((v: any) => typeof v === 'number' ? v : v?.valor ?? NaN).filter((v: number) => !isNaN(v));
    if (series.length === 0) return null;

    const ndviAtual = series[series.length - 1];
    const ndviMedio = parseFloat((series.reduce((s: number, v: number) => s + v, 0) / series.length).toFixed(4));

    return { ndviAtual: parseFloat(ndviAtual.toFixed(4)), ndviMedio };
  } catch {
    return null;
  }
}

export function classificarZonasManejo(points: NDVIGridPoint[]): {
  zonas: ZonaManejo[];
  alertas: string[];
  diagnostico: string;
} {
  const zonasConfig = [
    { nome: 'Alta Performance', classificacao: 'alta' as const, cor: '#22c55e', min: 0.7, max: 1.0 },
    { nome: 'Performance Média', classificacao: 'media' as const, cor: '#eab308', min: 0.4, max: 0.7 },
    { nome: 'Baixa Performance', classificacao: 'baixa' as const, cor: '#f97316', min: 0.2, max: 0.4 },
    { nome: 'Zona Crítica', classificacao: 'critica' as const, cor: '#ef4444', min: -1, max: 0.2 },
  ];

  const zonas: ZonaManejo[] = zonasConfig.map(cfg => {
    const ptsFiltrados = points.filter(p => p.ndviAtual >= cfg.min && p.ndviAtual < cfg.max);
    const ndviMedio = ptsFiltrados.length > 0
      ? parseFloat((ptsFiltrados.reduce((s, p) => s + p.ndviAtual, 0) / ptsFiltrados.length).toFixed(4))
      : 0;
    return {
      nome: cfg.nome,
      classificacao: cfg.classificacao,
      cor: cfg.cor,
      pontos: ptsFiltrados,
      ndviMedio,
      percentual: points.length > 0 ? parseFloat(((ptsFiltrados.length / points.length) * 100).toFixed(1)) : 0,
    };
  }).filter(z => z.pontos.length > 0);

  const alertas: string[] = [];
  const valores = points.map(p => p.ndviAtual);
  const media = valores.reduce((s, v) => s + v, 0) / valores.length;

  const zonaBaixa = zonas.find(z => z.classificacao === 'baixa');
  const zonaCritica = zonas.find(z => z.classificacao === 'critica');

  if (zonaCritica && zonaCritica.pontos.length > 0) {
    alertas.push(`⚠️ ${zonaCritica.pontos.length} ponto(s) em zona CRÍTICA (NDVI < 0.2) — possível solo exposto, falha de plantio ou degradação severa`);
  }
  if (zonaBaixa && zonaBaixa.pontos.length > 0) {
    alertas.push(`⚠️ ${zonaBaixa.pontos.length} ponto(s) com baixa performance (NDVI 0.2–0.4) — possível estresse hídrico, praga ou falha de adubação`);
  }

  const desvio = Math.sqrt(valores.reduce((s, v) => s + Math.pow(v - media, 2), 0) / valores.length);
  const cv = media > 0 ? (desvio / media) * 100 : 0;
  const uniformidade = Math.max(0, 100 - cv);

  let diagnostico = '';
  if (cv > 20) {
    diagnostico = `Alta variabilidade (CV ${cv.toFixed(1)}%) — recomenda-se investigação detalhada das zonas de baixa performance. Considerar amostragem de solo dirigida e imagens de drone.`;
  } else if (cv > 10) {
    diagnostico = `Variabilidade moderada (CV ${cv.toFixed(1)}%) — existem diferenças significativas entre zonas. Avaliar manejo diferenciado por zona.`;
  } else if (cv > 5) {
    diagnostico = `Variabilidade baixa (CV ${cv.toFixed(1)}%) — lavoura relativamente uniforme. Manejo pode ser homogêneo.`;
  } else {
    diagnostico = `Lavoura muito uniforme (CV ${cv.toFixed(1)}%) — excelente homogeneidade. Uniformidade: ${uniformidade.toFixed(0)}%.`;
  }

  if (media >= 0.7) {
    diagnostico += ` NDVI médio ${media.toFixed(2)} indica vegetação densa e saudável.`;
  } else if (media >= 0.4) {
    diagnostico += ` NDVI médio ${media.toFixed(2)} indica vegetação moderada — monitorar evolução.`;
  } else {
    diagnostico += ` NDVI médio ${media.toFixed(2)} indica vegetação escassa — atenção redobrada.`;
  }

  return { zonas, alertas, diagnostico };
}

export async function consultarNDVIGrid(
  polygon: number[][],
  gridSize: number = 5
): Promise<NDVIGridResult | null> {
  const token = await getEmbrapaToken();
  if (!token) return null;

  const gridPoints = gerarGridDentroPoligono(polygon, gridSize);
  if (gridPoints.length === 0) return null;

  const CONCURRENCY = 5;
  const results: NDVIGridPoint[] = [];

  for (let i = 0; i < gridPoints.length; i += CONCURRENCY) {
    const batch = gridPoints.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(pt => consultarNDVIPonto(token, pt.lat, pt.lon))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled' && r.value) {
        results.push({
          lat: batch[j].lat,
          lon: batch[j].lon,
          ndviAtual: r.value.ndviAtual,
          ndviMedio: r.value.ndviMedio,
        });
      }
    }
  }

  if (results.length === 0) return null;

  const valores = results.map(p => p.ndviAtual);
  const media = parseFloat((valores.reduce((s, v) => s + v, 0) / valores.length).toFixed(4));
  const min = parseFloat(Math.min(...valores).toFixed(4));
  const max = parseFloat(Math.max(...valores).toFixed(4));
  const desvio = parseFloat(Math.sqrt(valores.reduce((s, v) => s + Math.pow(v - media, 2), 0) / valores.length).toFixed(4));
  const cv = media > 0 ? parseFloat(((desvio / media) * 100).toFixed(1)) : 0;
  const uniformidade = parseFloat(Math.max(0, 100 - cv).toFixed(1));

  const lats = polygon.map(c => c[1]);
  const lons = polygon.map(c => c[0]);

  const { zonas, alertas, diagnostico } = classificarZonasManejo(results);

  return {
    points: results,
    stats: { min, max, media, desvio, cv, uniformidade },
    zonas,
    alertas,
    diagnostico,
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    timestamp: new Date().toISOString(),
  };
}

export async function checkAgritecHealth(): Promise<boolean> {
  const token = await getEmbrapaToken();
  if (!token) return false;
  try {
    const res = await axios.get('https://api.cnptia.embrapa.br/agritec/v2/health', {
      headers: { Authorization: `Bearer ${token}` }, timeout: 8000,
    });
    return res.status === 200 || res.status === 204;
  } catch {
    return false;
  }
}

export interface EnriquecimentoAgroCompleto {
  solo: SoilGridsResult | null;
  clima: ClimaResult | null;
  zarc: ZarcResult[];
  cultivares: CultivaresResult[];
  produtividade: ProdutividadeResult[];
  ndviSatveg: SATVegNDVIResult | null;
  parcelasSigef: SigefParcela[];
  scoreAgro: number;
  resumo: string;
}

export async function enriquecerFazenda(params: {
  lat: number;
  lon: number;
  codIBGE?: string;
  cnpj?: string;
  culturaPrincipal?: string;
}): Promise<EnriquecimentoAgroCompleto> {
  const { lat, lon, codIBGE, cnpj, culturaPrincipal } = params;

  const hasEmbrapaKeys = !!(process.env.EMBRAPA_CONSUMER_KEY || process.env.EMBRAPA_CLIENT_ID);

  const [soloResult, climaResult, ndviSatveg, parcelasSigef] = await Promise.all([
    consultarSoloSoilGrids(lat, lon),
    hasEmbrapaKeys ? consultarClimaEmbrapa(lat, lon) : Promise.resolve(null),
    hasEmbrapaKeys ? consultarNDVISATVeg(lat, lon) : Promise.resolve(null),
    cnpj ? consultarParcelasSIGEF(cnpj) : Promise.resolve([]),
  ]);

  const culturas = culturaPrincipal ? [culturaPrincipal] : ['soja', 'milho'];
  let zarc: ZarcResult[] = [];
  let cultivares: CultivaresResult[] = [];
  let produtividade: ProdutividadeResult[] = [];

  if (codIBGE && hasEmbrapaKeys) {
    const embrapaResults = await Promise.allSettled([
      ...culturas.map(c => consultarZARC(codIBGE, c)),
      ...culturas.map(c => consultarCultivares(codIBGE, c)),
      ...culturas.map(c => consultarProdutividade(codIBGE, c)),
    ]);

    const n = culturas.length;
    zarc = embrapaResults.slice(0, n).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ZarcResult[];
    cultivares = embrapaResults.slice(n, 2*n).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as CultivaresResult[];
    produtividade = embrapaResults.slice(2*n).map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean) as ProdutividadeResult[];
  }

  const scoreAgro = calcularScoreAgro(soloResult, zarc, ndviSatveg);
  const resumo = gerarResumoAgro(soloResult, zarc, produtividade, parcelasSigef, climaResult, ndviSatveg);

  return { solo: soloResult, clima: climaResult, zarc, cultivares, produtividade, ndviSatveg, parcelasSigef, scoreAgro, resumo };
}

function calcularScoreAgro(solo: SoilGridsResult | null, zarc: ZarcResult[], ndvi?: SATVegNDVIResult | null): number {
  let score = 50;

  if (solo) {
    if (solo.phh2o !== null) {
      if (solo.phh2o >= 5.5 && solo.phh2o <= 7.0) score += 10;
      else if (solo.phh2o < 4.5 || solo.phh2o > 8.0) score -= 10;
    }
    if (solo.clay !== null) {
      if (solo.clay >= 20 && solo.clay <= 60) score += 10;
      else if (solo.clay < 10 || solo.clay > 80) score -= 10;
    }
    if (solo.soc !== null) {
      if (solo.soc > 15) score += 10;
      else if (solo.soc < 5) score -= 5;
    }
    if (solo.wv0033 !== null && solo.wv1500 !== null) {
      const aguaDisponivel = solo.wv0033 - solo.wv1500;
      if (aguaDisponivel > 10) score += 10;
    }
  }

  if (ndvi && (ndvi.ndviMedio > 0 || ndvi.eviMedio > 0)) {
    const val = ndvi.ndviMedio > 0 ? ndvi.ndviMedio : ndvi.eviMedio;
    if (val >= 0.7) score += 10;
    else if (val >= 0.4) score += 5;
    else if (val < 0.2) score -= 5;
  }

  const aptos = zarc.filter(z => z?.aptidao === 'Apto').length;
  const total = zarc.length;
  if (total > 0) {
    const pctApto = aptos / total;
    if (pctApto >= 0.8) score += 10;
    else if (pctApto <= 0.2) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

function gerarResumoAgro(
  solo: SoilGridsResult | null,
  zarc: ZarcResult[],
  produtividade: ProdutividadeResult[],
  parcelas: SigefParcela[],
  clima?: ClimaResult | null,
  ndvi?: SATVegNDVIResult | null,
): string {
  const partes: string[] = [];

  if (solo) {
    const ph = solo.phh2o;
    if (ph !== null) {
      if (ph < 5.0) partes.push(`Solo ácido (pH ${ph}) — pode precisar de calagem`);
      else if (ph > 7.5) partes.push(`Solo alcalino (pH ${ph})`);
      else partes.push(`pH adequado (${ph})`);
    }
    if (solo.clay !== null) {
      if (solo.clay > 60) partes.push(`Solo muito argiloso (${solo.clay}%)`);
      else if (solo.clay < 15) partes.push(`Solo arenoso (argila: ${solo.clay}%)`);
      else partes.push(`Textura equilibrada (argila: ${solo.clay}%)`);
    }
  }

  const aptos = zarc.filter(z => z?.aptidao === 'Apto').map(z => z.cultura);
  if (aptos.length > 0) partes.push(`Apto para: ${aptos.join(', ')}`);

  const prodPrincipal = produtividade[0];
  if (prodPrincipal?.estimativa) {
    partes.push(`Produtividade estimada de ${prodPrincipal.cultura}: ${prodPrincipal.estimativa} ${prodPrincipal.unidade}`);
  }

  if (clima && (clima.precipitacaoMedia > 0 || clima.temperaturaMaxMedia > 0)) {
    const tempMedia = clima.temperaturaMinMedia && clima.temperaturaMaxMedia
      ? ((clima.temperaturaMinMedia + clima.temperaturaMaxMedia) / 2).toFixed(1)
      : null;
    const parts = [];
    if (tempMedia) parts.push(`temp. média ${tempMedia}°C`);
    if (clima.precipitacaoMedia > 0) parts.push(`precip. ${clima.precipitacaoMedia} mm`);
    if (parts.length > 0) partes.push(`Clima: ${parts.join(', ')} (previsão NCEP-GFS)`);
  }

  if (ndvi && (ndvi.ndviMedio > 0 || ndvi.eviMedio > 0)) {
    const val = ndvi.ndviMedio > 0 ? ndvi.ndviMedio : ndvi.eviMedio;
    const label = ndvi.ndviMedio > 0 ? 'NDVI' : 'EVI';
    const cls = val >= 0.7 ? 'Vegetação densa' : val >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa';
    partes.push(`${label} ${val.toFixed(2)} (${cls}, ${ndvi.fonte})`);
  }

  if (parcelas.length > 0) {
    const totalHa = parcelas.reduce((s, p) => s + p.area, 0).toFixed(0);
    partes.push(`${parcelas.length} parcela(s) certificada(s) no SIGEF — total: ${totalHa} ha`);
  }

  return partes.length > 0 ? partes.join('. ') + '.' : 'Análise agro indisponível.';
}
