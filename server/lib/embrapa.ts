import { db } from "../db";
import { sql } from "drizzle-orm";

const TOKEN_URL = "https://api.cnptia.embrapa.br/token";
const BASE_URL  = "https://api.cnptia.embrapa.br";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const key    = process.env.EMBRAPA_CONSUMER_KEY!;
  const secret = process.env.EMBRAPA_CONSUMER_SECRET!;

  if (!key || !secret) {
    throw new Error("EMBRAPA_CONSUMER_KEY ou EMBRAPA_CONSUMER_SECRET não configurados");
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Erro ao obter token Embrapa: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = {
    token:     data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return cachedToken.token;
}

async function get(path: string): Promise<any> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Embrapa API erro ${res.status}: ${path}`);
  return res.json();
}

async function getCached(namespace: string, key: string): Promise<any | null> {
  try {
    const rows = await db.execute(
      sql`SELECT value, expires_at FROM cache_embrapa
          WHERE namespace = ${namespace} AND key = ${key}
          AND expires_at > NOW()
          LIMIT 1`
    );
    if (rows.rows.length > 0) {
      return JSON.parse(rows.rows[0].value as string);
    }
  } catch { }
  return null;
}

async function setCached(namespace: string, key: string, value: any): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO cache_embrapa (namespace, key, value, expires_at)
          VALUES (${namespace}, ${key}, ${JSON.stringify(value)}, NOW() + INTERVAL '30 days')
          ON CONFLICT (namespace, key) DO UPDATE
          SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`
    );
  } catch { }
}

export async function getZoneamentoAgricola(codigoIbge: string): Promise<{
  culturas: Array<{ nome: string; risco: string; epocaPlantio: string }>;
  fonte: "cache" | "api";
} | null> {
  const cacheKey = `zarc_${codigoIbge}`;
  const cached = await getCached("agritec", cacheKey);
  if (cached) return { ...cached, fonte: "cache" };

  try {
    const data = await get(`/agritec/v2/zarc/municipio/${codigoIbge}`);
    const result = {
      culturas: (data || []).map((item: any) => ({
        nome:         item.cultura || item.nome_cultura || "",
        risco:        item.nivel_risco || item.risco || "",
        epocaPlantio: item.epoca_plantio || item.periodo || "",
      })).filter((c: any) => c.nome),
    };
    await setCached("agritec", cacheKey, result);
    return { ...result, fonte: "api" };
  } catch (e: any) {
    console.warn("Agritec indisponível:", e.message);
    return null;
  }
}

export async function getClassificacaoSolo(lat: number, lon: number): Promise<{
  classificacao: string;
  aptidao: string;
  textura: string;
  fonte: "cache" | "api";
} | null> {
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = await getCached("smartsolos", cacheKey);
  if (cached) return { ...cached, fonte: "cache" };

  try {
    const data = await get(`/smartsolosexpert/v1/solo?lat=${lat}&lon=${lon}`);
    const result = {
      classificacao: data.classificacao || data.solo || "Não identificado",
      aptidao:       data.aptidao_agricola || data.aptidao || "",
      textura:       data.textura || "",
    };
    await setCached("smartsolos", cacheKey, result);
    return { ...result, fonte: "api" };
  } catch (e: any) {
    console.warn("SmartSolos indisponível:", e.message);
    return null;
  }
}

export async function getDadosClimaticos(lat: number, lon: number): Promise<{
  precipitacaoMedia: number;
  temperaturaMedia: number;
  indiceSeca: string;
  fonte: "cache" | "api";
} | null> {
  const cacheKey = `${lat.toFixed(1)}_${lon.toFixed(1)}`;
  const cached = await getCached("climapi", cacheKey);
  if (cached) return { ...cached, fonte: "cache" };

  try {
    const dataPrec = await get(
      `/climapi/v1/ncep-gfs/prec/${new Date().toISOString().split("T")[0]}/${lon}/${lat}`
    );
    const result = {
      precipitacaoMedia: dataPrec?.value || dataPrec?.precipitacao || 0,
      temperaturaMedia:  0,
      indiceSeca:        "Dados climáticos disponíveis",
    };
    await setCached("climapi", cacheKey, result);
    return { ...result, fonte: "api" };
  } catch (e: any) {
    console.warn("ClimAPI indisponível:", e.message);
    return null;
  }
}

export async function getNDVI(lat: number, lon: number): Promise<{
  ndvi: number;
  classificacao: string;
  fonte: "cache" | "api";
} | null> {
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}`;
  const cached = await getCached("satveg", cacheKey);
  if (cached) return { ...cached, fonte: "cache" };

  try {
    const data = await get(`/satveg/v2/perfil/ponto/ndvi/${lon}/${lat}`);
    const valores: number[] = data?.listaSerie || data?.serie || [];
    const ndvi = valores.length > 0
      ? valores[valores.length - 1]
      : 0;

    const classificacao =
      ndvi >= 0.7 ? "Vegetação densa e saudável" :
      ndvi >= 0.5 ? "Vegetação moderada" :
      ndvi >= 0.3 ? "Vegetação esparsa" :
      ndvi >= 0.1 ? "Solo exposto / degradado" :
      "Sem vegetação detectada";

    const result = { ndvi: Math.round(ndvi * 100) / 100, classificacao };
    await setCached("satveg", cacheKey, result);
    return { ...result, fonte: "api" };
  } catch (e: any) {
    console.warn("SATVeg indisponível:", e.message);
    return null;
  }
}

export async function getCulturasAgrofit(cultura: string): Promise<{
  defensivosRegistrados: number;
  fonte: "cache" | "api";
} | null> {
  const cacheKey = cultura.toLowerCase().replace(/\s/g, "_");
  const cached = await getCached("agrofit", cacheKey);
  if (cached) return { ...cached, fonte: "cache" };

  try {
    const data = await get(`/agrofit/v1/defensivos?cultura=${encodeURIComponent(cultura)}`);
    const result = {
      defensivosRegistrados: Array.isArray(data) ? data.length : (data?.total || 0),
    };
    await setCached("agrofit", cacheKey, result);
    return { ...result, fonte: "api" };
  } catch (e: any) {
    console.warn("Agrofit indisponível:", e.message);
    return null;
  }
}

export async function enriquecerAtivoEmbrapa(params: {
  codigoIbge?: string;
  lat?: number;
  lon?: number;
  tipo: string;
}): Promise<{
  zoneamento:  Awaited<ReturnType<typeof getZoneamentoAgricola>>;
  solo:        Awaited<ReturnType<typeof getClassificacaoSolo>>;
  clima:       Awaited<ReturnType<typeof getDadosClimaticos>>;
  ndvi:        Awaited<ReturnType<typeof getNDVI>>;
  enriquecidoEm: string;
}> {
  const { codigoIbge, lat, lon, tipo } = params;
  const tiposRurais = ["TERRA", "AGRO"];

  if (!tiposRurais.includes(tipo)) {
    return { zoneamento: null, solo: null, clima: null, ndvi: null, enriquecidoEm: new Date().toISOString() };
  }

  const [zoneamento, solo, clima, ndvi] = await Promise.allSettled([
    codigoIbge ? getZoneamentoAgricola(codigoIbge) : Promise.resolve(null),
    lat && lon ? getClassificacaoSolo(lat, lon) : Promise.resolve(null),
    lat && lon ? getDadosClimaticos(lat, lon) : Promise.resolve(null),
    lat && lon ? getNDVI(lat, lon) : Promise.resolve(null),
  ]);

  return {
    zoneamento:    zoneamento.status === "fulfilled" ? zoneamento.value : null,
    solo:          solo.status === "fulfilled" ? solo.value : null,
    clima:         clima.status === "fulfilled" ? clima.value : null,
    ndvi:          ndvi.status === "fulfilled" ? ndvi.value : null,
    enriquecidoEm: new Date().toISOString(),
  };
}
