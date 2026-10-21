/**
 * Cruzamento de restrições ambientais e fundiárias (CNUC, embargos ICMBio,
 * quilombolas, assentamentos, cavernas) — extraído da rota
 * /api/anm-enrichment/restricoes/cruzamento para poder ser reutilizado pelo
 * fluxo de relatório (export.ts), garantindo que TODO relatório rode o
 * conjunto completo de camadas.
 *
 * Falha de fonte = camada com consultado:false — nunca vira "não há restrição".
 */

const INDE_WFS = "https://geoservicos.inde.gov.br/geoserver/ows";
const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/ows";
const GEOSGB_ROOT = "https://geoportal.sgb.gov.br/server/rest/services";

async function fetchWithTimeout(url: string, timeout = 15000, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
}

// GeoServer WFS 2.0 nestes servidores usa ordem de eixos lat,lon
async function wfsGetJson(base: string, typeNames: string, extra: Record<string, string>, timeout = 20000): Promise<any | null> {
  try {
    const params = new URLSearchParams({
      service: "WFS", version: "2.0.0", request: "GetFeature",
      typeNames, outputFormat: "application/json", count: "200", ...extra,
    });
    const resp = await fetchWithTimeout(`${base}?${params.toString()}`, timeout);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.trimStart().startsWith("<")) return null; // ExceptionReport
    const json = JSON.parse(text);
    if (!json || !Array.isArray(json.features)) return null;
    return json;
  } catch {
    return null;
  }
}

async function queryGeoSgb(service: string, params: Record<string, string>, timeout = 25000): Promise<any | null> {
  try {
    const body = new URLSearchParams({ f: "json", ...params });
    const base = service.startsWith("/")
      ? `${GEOSGB_ROOT}${service}`
      : `${GEOSGB_ROOT}/geologia/${service}`;
    const resp = await fetchWithTimeout(`${base}/MapServer/0/query`, timeout, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    if (data.error) return null;
    return data;
  } catch {
    return null;
  }
}

const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// bbox em graus a partir de raio em km (ordem lat,lon dos servidores acima)
const bboxFromRadius = (lat: number, lon: number, raioKm: number): string => {
  const dLat = raioKm / 111.32;
  const dLon = raioKm / (111.32 * Math.max(Math.cos(lat * Math.PI / 180), 0.01));
  return `${lat - dLat},${lon - dLon},${lat + dLat},${lon + dLon}`;
};

// distância aproximada do ponto a uma feature (centro do bbox para polígonos)
const featureDistKm = (lat: number, lon: number, f: any): number | null => {
  try {
    if (f.geometry?.type === "Point") {
      const [x, y] = f.geometry.coordinates;
      return haversineKm(lat, lon, y, x);
    }
    if (Array.isArray(f.bbox) && f.bbox.length >= 4) {
      // ordem do bbox varia por servidor (INDE: lat,lon; IBGE: lon,lat).
      const a = (f.bbox[0] + f.bbox[2]) / 2;
      const b = (f.bbox[1] + f.bbox[3]) / 2;
      return f.bbox[0] < -35 ? haversineKm(lat, lon, b, a) : haversineKm(lat, lon, a, b);
    }
    if (f.geometry?.type === "MultiPoint") {
      const ds = f.geometry.coordinates.map(([x, y]: number[]) => haversineKm(lat, lon, y, x));
      return Math.min(...ds);
    }
    let coords = f.geometry?.coordinates;
    while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
    if (Array.isArray(coords) && coords.length >= 2) return haversineKm(lat, lon, coords[1], coords[0]);
  } catch {}
  return null;
};

export const RAIOS_PERMITIDOS_RESTRICOES = [10, 25, 50, 100];

export async function consultarRestricoesCruzamento(lat: number, lon: number, raioKm: number): Promise<any> {
  const ponto = `POINT(${lat} ${lon})`; // ordem lat,lon (eixos WFS 2.0)
  const bbox = bboxFromRadius(lat, lon, raioKm);

  const CNUC = "MMA:cnuc_2025_08";
  const EMBARGOS = "ICMBio:embargos_icmbio";
  const QUILOMBOLAS = "CGMAT:qg_2022_620_territorioquilombola__v02";
  const ASSENTAMENTOS = "CGEO:APL_Localidades_Projeto_De_Assentamento";

  const [ucSobre, ucRaio, embSobre, embRaio, quiSobre, quiRaio, assRaio, cavRaw] = await Promise.all([
    wfsGetJson(INDE_WFS, CNUC, { CQL_FILTER: `INTERSECTS(the_geom,${ponto})`, propertyName: "nome_uc,categoria,grupo,esfera,uf,municipio,ha_total" }),
    wfsGetJson(INDE_WFS, CNUC, { bbox, propertyName: "nome_uc,categoria,grupo,esfera,uf,municipio,ha_total" }),
    wfsGetJson(INDE_WFS, EMBARGOS, { CQL_FILTER: `INTERSECTS(the_geom,${ponto})`, propertyName: "numero_emb,autuado,tipo_infra,municipio,uf,ano,origem" }),
    wfsGetJson(INDE_WFS, EMBARGOS, { bbox, propertyName: "numero_emb,autuado,tipo_infra,municipio,uf,ano,origem" }),
    wfsGetJson(IBGE_WFS, QUILOMBOLAS, { CQL_FILTER: `INTERSECTS(geom,${ponto})`, propertyName: "nm_tq,status,sg_uf" }),
    wfsGetJson(IBGE_WFS, QUILOMBOLAS, { bbox, propertyName: "nm_tq,status,sg_uf" }),
    wfsGetJson(IBGE_WFS, ASSENTAMENTOS, { bbox, propertyName: "nm_localid,nm_municip,sigla_uf,nm_categor" }),
    queryGeoSgb("/Cavernas", {
      geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
      spatialRel: "esriSpatialRelIntersects", distance: String(raioKm * 1000), units: "esriSRUnit_Meter",
      outFields: "Caverna,Grau_de_Re,UF,Municipio,Localidade,Litotipo", returnGeometry: "true", outSR: "4326",
    }, 35000),
  ]);

  const mapFeats = (raw: any, mapper: (p: any, f: any) => any) =>
    (raw?.features || []).map((f: any) => {
      const item = mapper(f.properties || {}, f);
      const d = featureDistKm(lat, lon, f);
      return { ...item, distancia_km: d != null ? Math.round(d * 10) / 10 : null };
    }).filter((x: any) => x.distancia_km == null || x.distancia_km <= raioKm * 1.05)
      .sort((a: any, b: any) => (a.distancia_km ?? 999) - (b.distancia_km ?? 999))
      .slice(0, 40);

  const agora = new Date().toISOString();
  const camada = (sobre: any, raio: any, mapper: (p: any, f: any) => any, fonte: string, janelaCobertura: string | null) => {
    const consultado = raio !== null && (sobre === undefined || sobre !== null);
    const sobreposicao = sobre === undefined ? null : sobre === null ? null : (sobre.features || []).length > 0;
    const total = raio ? (typeof raio.totalFeatures === "number" && raio.totalFeatures >= 0 ? raio.totalFeatures : (raio.features || []).length) : 0;
    return {
      consultado,
      // três estados: falha de fonte = "não consultada" (nunca "sem restrição")
      estadoConsulta: !consultado
        ? ("nao_consultada" as const)
        : (sobreposicao === true || total > 0 ? ("registro_existente" as const) : ("consultada_sem_registro" as const)),
      // camada de restrição é fato territorial vigente — fonte não classifica situação
      situacaoRegistro: !consultado
        ? null
        : (sobreposicao === true || total > 0 ? ("indeterminada" as const) : null),
      tierFonte: "T1" as const,
      janelaCobertura,
      consultadoEm: agora,
      fonte,
      sobreposicao,
      sobreposicoes: sobre ? (sobre.features || []).slice(0, 10).map((f: any) => mapper(f.properties || {}, f)) : [],
      total,
      ocorrencias: raio ? mapFeats(raio, mapper) : [],
      distanciaAproximada: true, // distância calculada ao centro/vértice da geometria
    };
  };

  const mapUc = (p: any) => ({ nome: p.nome_uc, categoria: p.categoria, grupo: p.grupo, esfera: p.esfera, municipio: p.municipio, uf: p.uf });
  const mapEmb = (p: any) => ({ nome: p.autuado ? `${p.numero_emb ?? ""} — ${p.autuado}` : String(p.numero_emb ?? ""), tipo: p.tipo_infra, municipio: p.municipio, uf: p.uf, ano: p.ano, origem: p.origem });
  const mapQui = (p: any) => ({ nome: p.nm_tq, status: p.status, uf: p.sg_uf });
  const mapAss = (p: any) => ({ nome: p.nm_localid, categoria: p.nm_categor, municipio: p.nm_municip, uf: p.sigla_uf });

  const cavernasOcorr = (cavRaw?.features || []).map((f: any) => {
    const a = f.attributes || {}; const g = f.geometry || {};
    const d = g.x != null ? haversineKm(lat, lon, g.y, g.x) : null;
    return { nome: a.Caverna, relevancia: (a.Grau_de_Re || "").trim() || null, municipio: a.Municipio, uf: a.UF, localidade: a.Localidade, distancia_km: d != null ? Math.round(d * 10) / 10 : null };
  }).sort((a: any, b: any) => (a.distancia_km ?? 999) - (b.distancia_km ?? 999)).slice(0, 40);

  const camadas: any = {
    unidadesConservacao: camada(ucSobre, ucRaio, mapUc, "CNUC/MMA (via INDE)", "base CNUC 2025-08"),
    embargos: camada(embSobre, embRaio, mapEmb, "Embargos ICMBio (via INDE); embargos IBAMA sem serviço público ativo", "base ICMBio na INDE (data de atualização não informada pela fonte); NÃO cobre embargos IBAMA"),
    quilombolas: camada(quiSobre, quiRaio, mapQui, "IBGE Censo 2022 (delimitação INCRA)", "IBGE Censo 2022"),
    assentamentos: camada(undefined, assRaio, mapAss, "IBGE Localidades (projetos de assentamento)", "IBGE Localidades (data de atualização não informada pela fonte)"),
    cavernas: {
      consultado: cavRaw !== null,
      estadoConsulta: cavRaw === null
        ? ("nao_consultada" as const)
        : (cavernasOcorr.length > 0 ? ("registro_existente" as const) : ("consultada_sem_registro" as const)),
      situacaoRegistro: cavRaw === null
        ? null
        : (cavernasOcorr.length > 0 ? ("indeterminada" as const) : null),
      tierFonte: "T1" as const,
      janelaCobertura: "CANIE/CECAV base dez/2020 (cavidades registradas até essa data)",
      consultadoEm: agora,
      fonte: "CANIE/CECAV via SGB (base dez/2020)",
      sobreposicao: null,
      sobreposicoes: [],
      total: cavernasOcorr.length,
      ocorrencias: cavernasOcorr,
    },
  };

  // Semáforo: vermelho = sobreposição direta; amarelo = ocorrência no raio
  // ou fonte não consultada; verde = tudo consultado e nada encontrado.
  const valores = Object.values(camadas) as any[];
  const temSobreposicao = valores.some(c => c.sobreposicao === true);
  const temProximo = valores.some(c => c.consultado && c.total > 0);
  const naoConsultadas = valores.filter(c => !c.consultado).length;
  const semaforo = temSobreposicao ? "vermelho" : (temProximo || naoConsultadas > 0) ? "amarelo" : "verde";

  // ── Contrato comum no nível do módulo (detalhe por camada em `camadas`) ──
  // registro em qualquer camada = existente; nada encontrado só vale como
  // "sem registro" quando TODAS as camadas foram consultadas.
  const camadasFalha = valores.filter(c => !c.consultado).map(c => c.fonte);
  const estadoModulo = temSobreposicao || temProximo
    ? ("registro_existente" as const)
    : naoConsultadas > 0 ? ("nao_consultada" as const) : ("consultada_sem_registro" as const);
  const motivoEstado = naoConsultadas > 0
    ? `camada(s) não consultada(s): ${camadasFalha.join("; ")} — indisponibilidade não é ausência de restrição`
    : null;

  return {
    disponivel: true,
    estadoConsulta: estadoModulo,
    situacaoRegistro: estadoModulo === "registro_existente" ? ("indeterminada" as const) : null,
    ...(motivoEstado ? { motivoEstado } : {}),
    tierFonte: "T1" as const,
    janelaCobertura: valores.map(c => c.janelaCobertura).filter(Boolean).join("; ") || null,
    identificadorVinculo: {
      tipo: "geometria" as const,
      valor: `ponto ${lat},${lon} — raio ${raioKm} km`,
      proveniencia: "documento_oficial" as const,
      origem: "coordenadas do ativo (SIGMINE/ANM)",
    },
    raio_km: raioKm,
    semaforo,
    naoConsultadas,
    camadas,
    consultadoEm: new Date().toISOString(),
  };
}

// ── FUNAI (terras indígenas) via API Mavrion — mesma fonte das rotas
// /api/anm-enrichment/funai/* ──
const MAVRION_API_URL = "https://api.mavrionconnect.com.br";

async function mavrionGet(path: string, timeout = 15000): Promise<any | null> {
  try {
    const resp = await fetchWithTimeout(`${MAVRION_API_URL}${path}`, timeout, {
      headers: { "x-api-key": process.env.MAVRION_API_KEY || "" },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Consulta sobreposição e terras indígenas no raio; null em cada campo = fonte falhou. */
export async function consultarFunai(lat: number, lon: number, raioKm = 50): Promise<{ sobreposicao: any | null; terras: any | null }> {
  const [sobreposicao, terras] = await Promise.all([
    mavrionGet(`/api/funai/sobreposicao?lat=${lat}&lon=${lon}`),
    mavrionGet(`/api/funai/terras/raio?lat=${lat}&lon=${lon}&raio=${raioKm}`),
  ]);
  // carimba a data da consulta para o aviso de "consulta antiga" na UI;
  // tier/janela seguem o contrato de três estados (null = fonte falhou =
  // "não consultada", tratado pelo quadro de camadas)
  const consultadoEm = new Date().toISOString();
  const meta = {
    consultadoEm,
    tierFonte: "T1" as const,
    janelaCobertura: "terras indígenas FUNAI (espelho atualizado semanalmente)",
  };
  return {
    sobreposicao: sobreposicao ? { ...sobreposicao, ...meta } : null,
    terras: terras ? { ...terras, ...meta } : null,
  };
}

/**
 * Garante que o ativo tem o conjunto COMPLETO de camadas de restrição antes do
 * relatório: roda o cruzamento multi-fonte e a FUNAI quando faltarem.
 * Retorna um delta de camposEspecificos para persistir (ou {} se nada faltou).
 * Best-effort: falha de fonte fica registrada como camada não consultada.
 */
export async function completarCamadasRestricao(campos: any): Promise<Record<string, any>> {
  const lat = Number(campos?.latitude);
  const lon = Number(campos?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  const delta: Record<string, any> = {};

  const restr = campos?.anmRestricoes;
  const camadasOk = restr?.camadas && ["unidadesConservacao", "embargos", "quilombolas", "assentamentos", "cavernas"]
    .every(k => restr.camadas[k]?.consultado);
  if (!camadasOk) {
    try {
      const novo = await consultarRestricoesCruzamento(Math.round(lat * 10000) / 10000, Math.round(lon * 10000) / 10000, restr?.raio_km ?? 25);
      if (novo?.camadas) delta.anmRestricoes = novo;
    } catch {}
  }

  if (!campos?.anmFunai && !campos?.anmFunaiTerras) {
    try {
      const { sobreposicao, terras } = await consultarFunai(lat, lon, 50);
      if (sobreposicao) delta.anmFunai = sobreposicao;
      if (terras) delta.anmFunaiTerras = terras;
    } catch {}
  }

  return delta;
}
