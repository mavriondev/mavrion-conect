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

export interface CCIRResult {
  proprietarios: Array<{ nome: string; cpfCnpj: string; tipo?: string }>;
  denominacao: string;
  codigoIncra: string;
  nirf: string;
  modulosFiscais: number | null;
  classificacaoFundiaria: string;
  fracaoMinimaParcelamento: string;
  situacaoCadastral: string;
  dataEmissao: string;
  areaTotalIncra: string;
  rawData: any;
}

export async function consultarParcelasSIGEF(_cnpj: string): Promise<SigefParcela[]> {
  console.warn('[SIGEF] consultarParcelasSIGEF por CNPJ desativado (InfoSimples removido). Use consultarSIGEFPublicoPorCoordenadas.');
  return [];
}

async function sigefRequestWithRetry(url: string, options: any, maxRetries = 2): Promise<any> {
  let lastError: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (err: any) {
      lastError = err;
      const status = err.response?.status;
      if (status === 404 || status === 400) {
        throw err;
      }
      const isRetryable = !status || status >= 500 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';
      if (!isRetryable || attempt >= maxRetries) {
        throw err;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
      console.log(`[SIGEF] Retry ${attempt + 1}/${maxRetries} após ${delay}ms para ${url.substring(0, 80)}...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

export async function consultarSIGEFPorDocumento(cpfCnpj: string): Promise<CCIRResult | null> {
  try {
    const docLimpo = cpfCnpj.replace(/\D/g, '');
    if (docLimpo.length < 11) return null;

    console.log(`[SIGEF-DOC] Consultando parcelas por documento: ${docLimpo.substring(0, 3)}***`);

    const SIGEF_PER_REQUEST_TIMEOUT = 10000;

    const wfsEndpoints = [
      { base: 'https://sigef.incra.gov.br/geo/wfs', typeName: 'parcela_publica', geomField: 'geom' },
      { base: 'https://sigef.incra.gov.br/geo/parcela/wfs', typeName: 'sigef_publica:parcela_publica', geomField: 'geom' },
    ];

    let features: any[] = [];
    let allFailed = true;
    let lastError: any = null;

    for (const endpoint of wfsEndpoints) {
      const cqlFilter = `detentor_cpf_cnpj='${docLimpo}'`;
      const params = new URLSearchParams({
        service: 'WFS',
        version: '1.0.0',
        request: 'GetFeature',
        typeName: endpoint.typeName,
        outputFormat: 'application/json',
        CQL_FILTER: cqlFilter,
        maxFeatures: '10',
      });

      try {
        const res = await sigefRequestWithRetry(`${endpoint.base}?${params.toString()}`, {
          timeout: SIGEF_PER_REQUEST_TIMEOUT,
          headers: { 'Accept': 'application/json' },
        });

        allFailed = false;
        if (res.data?.features && Array.isArray(res.data.features) && res.data.features.length > 0) {
          console.log(`[SIGEF-DOC] ${endpoint.base} retornou ${res.data.features.length} parcela(s) por documento`);
          features = res.data.features;
          break;
        }
      } catch (err: any) {
        lastError = err;
        const status = err.response?.status || 'N/A';
        console.warn(`[SIGEF-DOC] ${endpoint.base} falhou (status=${status}): ${err.message}`);
      }
    }

    if (features.length === 0) {
      if (allFailed && lastError) {
        const isTimeout = lastError.code === 'ECONNABORTED' || lastError.code === 'ETIMEDOUT';
        const sigefError = new Error(isTimeout ? 'SIGEF não respondeu (timeout)' : `SIGEF erro: ${lastError.message}`);
        (sigefError as any).code = isTimeout ? 'ECONNABORTED' : 'SIGEF_ERROR';
        throw sigefError;
      }
      console.log('[SIGEF-DOC] Nenhuma parcela encontrada por documento');
      return null;
    }

    const feat = features[0];
    const props = feat.properties || {};

    const codigo = props.parcela_codigo || props.codigo || props.code || props.parcela_co || props.cod_parcela || '';
    const detentorNome = props.detentor_nome || props.nome_detentor || props.nome || props.proprietario || '';
    const detentorDoc = props.detentor_cpf_cnpj || props.cpf_cnpj || props.documento || props.cpf || props.cnpj || '';
    const detentorTipo = props.detentor_tipo || props.tipo_detentor || props.tipo || '';
    const areaHa = parseFloat(props.area_hectare || props.area_ha || props.area || 0);
    const municipio = props.municipio_nome || props.municipio || props.nome_municipio || '';
    const uf = props.uf || props.estado || props.sigla_uf || '';
    const situacao = props.situacao || props.status || props.situacao_parcela || '';
    const matricula = props.matricula || props.num_matricula || '';
    const cartorio = props.cartorio || props.serventia || props.nome_cartorio || '';
    const denominacao = props.denominacao || props.nome_imovel || '';
    const dataRegistro = props.data_registro || props.data_certificacao || props.data_submissao || '';

    console.log(`[SIGEF-DOC] Parcela encontrada: código=${codigo}, área=${areaHa}ha, ${municipio}/${uf}`);

    const proprietarios: Array<{ nome: string; cpfCnpj: string; tipo?: string }> = [];

    if (detentorNome || detentorDoc) {
      proprietarios.push({
        nome: detentorNome,
        cpfCnpj: mascararDocumento(detentorDoc),
        tipo: detentorTipo || 'Detentor SIGEF',
      });
    }

    for (const f of features.slice(1)) {
      const fp = f.properties || {};
      const fNome = fp.detentor_nome || fp.nome_detentor || fp.nome || '';
      const fDoc = fp.detentor_cpf_cnpj || fp.cpf_cnpj || fp.documento || '';
      const fTipo = fp.detentor_tipo || fp.tipo_detentor || fp.tipo || '';
      if (fNome || fDoc) {
        const docMascarado = mascararDocumento(fDoc);
        if (!proprietarios.some(p => p.nome === fNome && p.cpfCnpj === docMascarado)) {
          proprietarios.push({ nome: fNome, cpfCnpj: docMascarado, tipo: fTipo || 'Detentor SIGEF' });
        }
      }
    }

    const modulosFiscais = props.modulos_fiscais != null ? parseFloat(props.modulos_fiscais) : null;
    let classificacao = '';
    if (modulosFiscais !== null) {
      if (modulosFiscais <= 1) classificacao = 'Minifúndio';
      else if (modulosFiscais <= 4) classificacao = 'Pequena propriedade';
      else if (modulosFiscais <= 15) classificacao = 'Média propriedade';
      else classificacao = 'Grande propriedade';
    }

    const denominacaoFinal = denominacao || (municipio ? `Parcela Certificada — ${municipio}/${uf}` : `Parcela ${codigo}`);

    return {
      proprietarios,
      denominacao: denominacaoFinal,
      codigoIncra: codigo,
      nirf: props.nirf || '',
      modulosFiscais,
      classificacaoFundiaria: classificacao,
      fracaoMinimaParcelamento: modulosFiscais ? `${(modulosFiscais * 0.25).toFixed(2)} módulos fiscais` : '',
      situacaoCadastral: situacao ? `${situacao} (SIGEF/INCRA)` : '',
      dataEmissao: dataRegistro,
      areaTotalIncra: areaHa ? `${areaHa.toFixed(4)} ha` : '',
      rawData: { ...props, fonte: 'SIGEF API Pública (por documento)', matricula, cartorio, geometry: feat.geometry },
    };
  } catch (err: any) {
    const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'SIGEF_ERROR';
    if (isRetryable) {
      throw err;
    }
    console.error('[SIGEF-DOC] Erro ao consultar por documento:', err.message || err);
    return null;
  }
}

export function isSicarDisponivel(): boolean {
  return !!process.env.SICAR_DATABASE_URL;
}

let _sicarWarningLogged = false;
export function logSicarWarningOnce(): void {
  if (!_sicarWarningLogged && !process.env.SICAR_DATABASE_URL) {
    console.warn('[CCIR-SICAR] SICAR_DATABASE_URL não configurada — fallback SICAR não disponível');
    _sicarWarningLogged = true;
  }
}

export async function consultarSIGEFPublicoPorCoordenadas(lat: number, lon: number): Promise<CCIRResult | null> {
  try {
    const pointWkt = `POINT(${lon} ${lat})`;
    console.log(`[SIGEF-PUB] Consultando parcelas por coordenada: lat=${lat}, lon=${lon}`);

    const SIGEF_PER_REQUEST_TIMEOUT = 8000;
    const SIGEF_GLOBAL_TIMEOUT = 10000;

    const wfsEndpoints = [
      { base: 'https://sigef.incra.gov.br/geo/wfs', typeName: 'parcela_publica', geomField: 'geom' },
      { base: 'https://sigef.incra.gov.br/geo/parcela/wfs', typeName: 'sigef_publica:parcela_publica', geomField: 'geom' },
      { base: 'https://acervofundiario.incra.gov.br/i3geo/ogc.php', typeName: 'parcelas_sigef_publica', geomField: 'the_geom' },
    ];

    let features: any[] = [];

    const tryEndpoint = async (endpoint: typeof wfsEndpoints[0]): Promise<any[]> => {
      const filters = [
        `INTERSECTS(${endpoint.geomField}, ${pointWkt})`,
        `DWITHIN(${endpoint.geomField}, ${pointWkt}, 1000, meters)`,
      ];

      for (const cqlFilter of filters) {
        const params = new URLSearchParams({
          service: 'WFS',
          version: '1.0.0',
          request: 'GetFeature',
          typeName: endpoint.typeName,
          outputFormat: 'application/json',
          CQL_FILTER: cqlFilter,
          maxFeatures: '5',
        });

        try {
          const res = await sigefRequestWithRetry(`${endpoint.base}?${params.toString()}`, {
            timeout: SIGEF_PER_REQUEST_TIMEOUT,
            headers: { 'Accept': 'application/json' },
          });

          if (res.data?.features && Array.isArray(res.data.features) && res.data.features.length > 0) {
            console.log(`[SIGEF-PUB] ${endpoint.base} retornou ${res.data.features.length} parcela(s)`);
            return res.data.features;
          }
        } catch (err: any) {
          const status = err.response?.status || 'N/A';
          console.warn(`[SIGEF-PUB] ${endpoint.base} falhou (status=${status}): ${err.message}`);
        }
      }

      const bbox = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
      const bboxParams = new URLSearchParams({
        service: 'WFS',
        version: '1.0.0',
        request: 'GetFeature',
        typeName: endpoint.typeName,
        outputFormat: 'application/json',
        bbox: bbox,
        maxFeatures: '5',
      });

      try {
        const res = await sigefRequestWithRetry(`${endpoint.base}?${bboxParams.toString()}`, {
          timeout: SIGEF_PER_REQUEST_TIMEOUT,
          headers: { 'Accept': 'application/json' },
        });
        if (res.data?.features && Array.isArray(res.data.features) && res.data.features.length > 0) {
          console.log(`[SIGEF-PUB] BBOX em ${endpoint.base} retornou ${res.data.features.length} parcela(s)`);
          return res.data.features;
        }
      } catch (err: any) {
        console.warn(`[SIGEF-PUB] BBOX ${endpoint.base} falhou: ${err.message}`);
      }

      return [];
    };

    const globalTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('[SIGEF-PUB] Timeout global de 10s atingido')), SIGEF_GLOBAL_TIMEOUT)
    );

    let allEndpointsFailed = false;
    let lastEndpointError: any = null;
    try {
      const endpointPromises = wfsEndpoints.map(ep => tryEndpoint(ep));
      const results = await Promise.race([
        Promise.any(
          endpointPromises.map(p => p.then(feats => {
            if (feats.length === 0) throw new Error('empty');
            return feats;
          }))
        ),
        globalTimeout,
      ]);
      if (Array.isArray(results) && results.length > 0) {
        features = results;
      }
    } catch (err: any) {
      console.warn(`[SIGEF-PUB] Todas as consultas falharam ou timeout: ${err.message}`);
      allEndpointsFailed = true;
      lastEndpointError = err;
    }

    if (features.length === 0) {
      if (allEndpointsFailed && lastEndpointError) {
        const isTimeout = lastEndpointError.message?.includes('Timeout') || lastEndpointError.code === 'ECONNABORTED' || lastEndpointError.code === 'ETIMEDOUT';
        const sigefError = new Error(isTimeout ? 'SIGEF não respondeu (timeout)' : `SIGEF erro: ${lastEndpointError.message}`);
        (sigefError as any).code = isTimeout ? 'ECONNABORTED' : 'SIGEF_ERROR';
        throw sigefError;
      }
      console.log('[SIGEF-PUB] Nenhuma parcela encontrada nas coordenadas');
      return null;
    }

    const feat = features[0];
    const props = feat.properties || {};

    const codigo = props.parcela_codigo || props.codigo || props.code || props.parcela_co || props.cod_parcela || '';
    const detentorNome = props.detentor_nome || props.nome_detentor || props.nome || props.proprietario || '';
    const detentorDoc = props.detentor_cpf_cnpj || props.cpf_cnpj || props.documento || props.cpf || props.cnpj || '';
    const detentorTipo = props.detentor_tipo || props.tipo_detentor || props.tipo || '';
    const areaHa = parseFloat(props.area_hectare || props.area_ha || props.area || 0);
    const municipio = props.municipio_nome || props.municipio || props.nome_municipio || '';
    const uf = props.uf || props.estado || props.sigla_uf || '';
    const situacao = props.situacao || props.status || props.situacao_parcela || '';
    const matricula = props.matricula || props.num_matricula || '';
    const cartorio = props.cartorio || props.serventia || props.nome_cartorio || '';
    const denominacao = props.denominacao || props.nome_imovel || '';
    const dataRegistro = props.data_registro || props.data_certificacao || props.data_submissao || '';

    console.log(`[SIGEF-PUB] Parcela encontrada: código=${codigo}, área=${areaHa}ha, ${municipio}/${uf}, situação=${situacao}`);
    if (detentorNome) console.log(`[SIGEF-PUB] Detentor: ${detentorNome}`);

    const proprietarios: Array<{ nome: string; cpfCnpj: string; tipo?: string }> = [];

    if (detentorNome || detentorDoc) {
      proprietarios.push({
        nome: detentorNome,
        cpfCnpj: mascararDocumento(detentorDoc),
        tipo: detentorTipo || 'Detentor SIGEF',
      });
    }

    for (const f of features.slice(1)) {
      const fp = f.properties || {};
      const fNome = fp.detentor_nome || fp.nome_detentor || fp.nome || '';
      const fDoc = fp.detentor_cpf_cnpj || fp.cpf_cnpj || fp.documento || '';
      const fTipo = fp.detentor_tipo || fp.tipo_detentor || fp.tipo || '';
      if (fNome || fDoc) {
        const docMascarado = mascararDocumento(fDoc);
        if (!proprietarios.some(p => p.nome === fNome && p.cpfCnpj === docMascarado)) {
          proprietarios.push({ nome: fNome, cpfCnpj: docMascarado, tipo: fTipo || 'Detentor SIGEF' });
        }
      }
    }

    const modulosFiscais = props.modulos_fiscais != null ? parseFloat(props.modulos_fiscais) : null;
    let classificacao = '';
    if (modulosFiscais !== null) {
      if (modulosFiscais <= 1) classificacao = 'Minifúndio';
      else if (modulosFiscais <= 4) classificacao = 'Pequena propriedade';
      else if (modulosFiscais <= 15) classificacao = 'Média propriedade';
      else classificacao = 'Grande propriedade';
    }

    const denominacaoFinal = denominacao || (municipio ? `Parcela Certificada — ${municipio}/${uf}` : `Parcela ${codigo}`);

    return {
      proprietarios,
      denominacao: denominacaoFinal,
      codigoIncra: codigo,
      nirf: props.nirf || '',
      modulosFiscais,
      classificacaoFundiaria: classificacao,
      fracaoMinimaParcelamento: modulosFiscais ? `${(modulosFiscais * 0.25).toFixed(2)} módulos fiscais` : '',
      situacaoCadastral: situacao ? `${situacao} (SIGEF/INCRA)` : '',
      dataEmissao: dataRegistro,
      areaTotalIncra: areaHa ? `${areaHa.toFixed(4)} ha` : '',
      rawData: { ...props, fonte: 'SIGEF API Pública', matricula, cartorio, geometry: feat.geometry },
    };
  } catch (err: any) {
    const isRetryable = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'SIGEF_ERROR';
    if (isRetryable) {
      throw err;
    }
    console.error('[SIGEF-PUB] Erro ao consultar API pública:', err.message || err);
    return null;
  }
}

function mascararDocumento(doc: string): string {
  if (!doc) return '';
  return doc;
}


export interface ClimaResult {
  precipitacaoMedia: number;
  temperaturaMaxMedia: number;
  temperaturaMinMedia: number;
  fonte: string;
  precipitacaoAnual?: number;
  precipitacaoMensal?: number[];
  temperaturaMensal?: number[];
  mesesSecos?: string[];
  mesesChuvosos?: string[];
  anoReferencia?: number;
}

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const climaCache = new Map<string, { data: ClimaResult; ts: number }>();
const CLIMA_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function diasNoMes(mes: number, ano: number): number {
  return new Date(ano, mes + 1, 0).getDate();
}

export async function consultarClimaNASAPower(lat: number, lon: number): Promise<ClimaResult | null> {
  const anoFim = new Date().getFullYear() - 1;
  const anoInicio = anoFim - 4;
  const cacheKey = `openmeteo_${lat.toFixed(2)}_${lon.toFixed(2)}_${anoInicio}_${anoFim}`;
  const cached = climaCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CLIMA_CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${anoInicio}-01-01&end_date=${anoFim}-12-31&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean&timezone=America/Sao_Paulo`;
    const resp = await axios.get(url, { timeout: 25000 });
    const daily = resp.data?.daily;
    if (!daily?.precipitation_sum || !daily?.time) {
      console.error('[Open-Meteo] Dados diários ausentes');
      return null;
    }

    const dates: string[] = daily.time;
    const precArr: (number | null)[] = daily.precipitation_sum;
    const tmaxArr: (number | null)[] = daily.temperature_2m_max || [];
    const tminArr: (number | null)[] = daily.temperature_2m_min || [];
    const tmeanArr: (number | null)[] = daily.temperature_2m_mean || [];

    const nAnos = anoFim - anoInicio + 1;
    const precipMensalAcum = new Array(12).fill(0);
    const tempMensalAcum = new Array(12).fill(0);
    const tempMensalCount = new Array(12).fill(0);
    let tmaxMax = -999;
    let tminMin = 999;
    const tmaxAllVals: number[] = [];
    const tminAllVals: number[] = [];

    for (let i = 0; i < dates.length; i++) {
      const m = parseInt(dates[i].split('-')[1], 10) - 1;
      precipMensalAcum[m] += (precArr[i] ?? 0);
      if (tmeanArr[i] != null) {
        tempMensalAcum[m] += tmeanArr[i]!;
        tempMensalCount[m]++;
      }
      if (tmaxArr[i] != null) tmaxAllVals.push(tmaxArr[i]!);
      if (tminArr[i] != null) tminAllVals.push(tminArr[i]!);
    }

    const precipMensal = precipMensalAcum.map(v => parseFloat((v / nAnos).toFixed(1)));
    const precipAnual = parseFloat(precipMensal.reduce((s, v) => s + v, 0).toFixed(1));
    const temperaturaMensal = tempMensalAcum.map((v, i) =>
      tempMensalCount[i] > 0 ? parseFloat((v / tempMensalCount[i]).toFixed(1)) : 0
    );

    if (tmaxAllVals.length > 0) {
      tmaxAllVals.sort((a, b) => b - a);
      tmaxMax = parseFloat((tmaxAllVals.slice(0, Math.ceil(tmaxAllVals.length * 0.05)).reduce((s, v) => s + v, 0) / Math.ceil(tmaxAllVals.length * 0.05)).toFixed(1));
    }
    if (tminAllVals.length > 0) {
      tminAllVals.sort((a, b) => a - b);
      tminMin = parseFloat((tminAllVals.slice(0, Math.ceil(tminAllVals.length * 0.05)).reduce((s, v) => s + v, 0) / Math.ceil(tminAllVals.length * 0.05)).toFixed(1));
    }

    const mesesSecos = precipMensal.map((v, i) => v < 60 ? MESES_PT[i] : null).filter(Boolean) as string[];
    const mesesChuvosos = precipMensal.map((v, i) => v > 150 ? MESES_PT[i] : null).filter(Boolean) as string[];

    const result: ClimaResult = {
      precipitacaoMedia: parseFloat((precipAnual / 12).toFixed(1)),
      precipitacaoAnual: precipAnual,
      precipitacaoMensal: precipMensal,
      temperaturaMensal,
      temperaturaMaxMedia: tmaxMax > -999 ? tmaxMax : 0,
      temperaturaMinMedia: tminMin < 999 ? tminMin : 0,
      mesesSecos,
      mesesChuvosos,
      anoReferencia: anoFim,
      fonte: `Open-Meteo ERA5 (${anoInicio}-${anoFim})`,
    };
    climaCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (err: any) {
    console.error('[Open-Meteo] Erro, tentando NASA POWER fallback:', err.message);
    try {
      const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR,T2M,T2M_MAX,T2M_MIN&community=AG&longitude=${lon}&latitude=${lat}&start=${anoFim}&end=${anoFim}&format=JSON`;
      const resp = await axios.get(url, { timeout: 20000 });
      const params = resp.data?.properties?.parameter;
      if (!params?.PRECTOTCORR || !params?.T2M) return null;

      const prec = params.PRECTOTCORR;
      const temp = params.T2M;
      const tmax = params.T2M_MAX || {};
      const tmin = params.T2M_MIN || {};

      const precipMensal: number[] = [];
      const tempMensalArr: number[] = [];
      let precipAnual = 0;
      let tmaxMax2 = -999;
      let tminMin2 = 999;

      for (let m = 0; m < 12; m++) {
        const key = `${anoFim}${String(m + 1).padStart(2, '0')}`;
        const dias = diasNoMes(m, anoFim);
        const precMes = parseFloat(((prec[key] ?? 0) * dias).toFixed(1));
        precipMensal.push(precMes);
        precipAnual += precMes;
        const t = temp[key];
        tempMensalArr.push(t != null ? parseFloat(t.toFixed(1)) : 0);
        if (tmax[key] != null && tmax[key] > tmaxMax2) tmaxMax2 = tmax[key];
        if (tmin[key] != null && tmin[key] < tminMin2) tminMin2 = tmin[key];
      }
      precipAnual = parseFloat(precipAnual.toFixed(1));
      const mesesSecos = precipMensal.map((v, i) => v < 60 ? MESES_PT[i] : null).filter(Boolean) as string[];
      const mesesChuvosos = precipMensal.map((v, i) => v > 150 ? MESES_PT[i] : null).filter(Boolean) as string[];

      const fallbackResult: ClimaResult = {
        precipitacaoMedia: parseFloat((precipAnual / 12).toFixed(1)),
        precipitacaoAnual: precipAnual,
        precipitacaoMensal: precipMensal,
        temperaturaMensal: tempMensalArr,
        temperaturaMaxMedia: tmaxMax2 > -999 ? parseFloat(tmaxMax2.toFixed(1)) : 0,
        temperaturaMinMedia: tminMin2 < 999 ? parseFloat(tminMin2.toFixed(1)) : 0,
        mesesSecos,
        mesesChuvosos,
        anoReferencia: anoFim,
        fonte: `NASA POWER (${anoFim})`,
      };
      climaCache.set(cacheKey, { data: fallbackResult, ts: Date.now() });
      return fallbackResult;
    } catch (err2: any) {
      console.error('[NASA POWER fallback] Erro:', err2.message);
      return null;
    }
  }
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

  const [soloResult, nasaPowerResult, ndviSatveg] = await Promise.all([
    consultarSoloSoilGrids(lat, lon),
    consultarClimaNASAPower(lat, lon),
    hasEmbrapaKeys ? consultarNDVISATVeg(lat, lon) : Promise.resolve(null),
  ]);
  const climaResult = nasaPowerResult || (hasEmbrapaKeys ? await consultarClimaEmbrapa(lat, lon) : null);

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
  const resumo = gerarResumoAgro(soloResult, zarc, produtividade, climaResult, ndviSatveg);

  return { solo: soloResult, clima: climaResult, zarc, cultivares, produtividade, ndviSatveg, scoreAgro, resumo };
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

  return partes.length > 0 ? partes.join('. ') + '.' : 'Análise agro indisponível.';
}

export async function consultarCCIRViaSICAR(lat: number, lon: number, cafProdutores?: any[]): Promise<CCIRResult | null> {
  try {
    const sicarDbUrl = process.env.SICAR_DATABASE_URL;
    if (!sicarDbUrl) {
      logSicarWarningOnce();
      return null;
    }

    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: sicarDbUrl });
    await client.connect();

    try {
      const query = `
        SELECT cod_imovel, num_area, municipio, uf, condicao, m_fiscal,
               properties->>'tipo_imovel' as tipo_imovel,
               properties->>'status_imovel' as status_imovel,
               properties->>'dat_criacao' as dat_criacao,
               properties->>'data_atualizacao' as data_atualizacao,
               ST_Area(geom::geography) / 10000.0 as area_geo_ha
        FROM sicar_imoveis_cache
        WHERE geom IS NOT NULL
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
        LIMIT 1
      `;
      const result = await client.query(query, [lon, lat]);

      if (result.rows.length === 0) {
        const nearbyQuery = `
          SELECT cod_imovel, num_area, municipio, uf, condicao, m_fiscal,
                 properties->>'tipo_imovel' as tipo_imovel,
                 properties->>'status_imovel' as status_imovel,
                 properties->>'dat_criacao' as dat_criacao,
                 properties->>'data_atualizacao' as data_atualizacao,
                 ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as dist_m
          FROM sicar_imoveis_cache
          WHERE geom IS NOT NULL
            AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 500)
          ORDER BY dist_m
          LIMIT 1
        `;
        const nearby = await client.query(nearbyQuery, [lon, lat]);
        if (nearby.rows.length === 0) {
          console.log('[CCIR-SICAR] Nenhum imóvel encontrado nas coordenadas');
          return null;
        }
        result.rows = nearby.rows;
      }

      const row = result.rows[0];
      console.log(`[CCIR-SICAR] Imóvel encontrado: ${row.cod_imovel} (${row.num_area} ha, ${row.municipio}/${row.uf})`);

      const proprietarios: Array<{ nome: string; cpfCnpj: string; tipo?: string }> = [];
      if (cafProdutores && Array.isArray(cafProdutores)) {
        for (const p of cafProdutores.slice(0, 5)) {
          if (p.nome) {
            proprietarios.push({
              nome: p.nome,
              cpfCnpj: p.cpfMascarado || '',
              tipo: p.grauParentesco || p.classificacao || 'Produtor CAF',
            });
          }
        }
      }

      const statusMap: Record<string, string> = {
        'AT': 'Ativo',
        'CA': 'Cancelado',
        'PE': 'Pendente',
        'SU': 'Suspenso',
      };
      const tipoMap: Record<string, string> = {
        'IRU': 'Imóvel Rural',
        'ASS': 'Assentamento',
        'TI': 'Terra Indígena',
        'UC': 'Unidade de Conservação',
      };

      const modulosFiscais = row.m_fiscal ? parseFloat(row.m_fiscal) : null;
      let classificacao = '';
      if (modulosFiscais !== null) {
        if (modulosFiscais <= 1) classificacao = 'Minifúndio';
        else if (modulosFiscais <= 4) classificacao = 'Pequena propriedade';
        else if (modulosFiscais <= 15) classificacao = 'Média propriedade';
        else classificacao = 'Grande propriedade';
      }

      return {
        proprietarios,
        denominacao: `${tipoMap[row.tipo_imovel] || 'Imóvel Rural'} — ${row.municipio}/${row.uf}`,
        codigoIncra: row.cod_imovel || '',
        nirf: '',
        modulosFiscais,
        classificacaoFundiaria: classificacao,
        fracaoMinimaParcelamento: modulosFiscais ? `${(modulosFiscais * 0.25).toFixed(2)} módulos fiscais` : '',
        situacaoCadastral: `${statusMap[row.status_imovel] || row.condicao || 'Desconhecido'} (CAR/SICAR)`,
        dataEmissao: row.data_atualizacao || row.dat_criacao || '',
        areaTotalIncra: row.num_area ? `${row.num_area} ha` : '',
        rawData: { ...row, fonte: 'SICAR/PostGIS' },
      };
    } finally {
      await client.end();
    }
  } catch (err: any) {
    console.error('[CCIR-SICAR] Erro:', err.message || err);
    return null;
  }
}

