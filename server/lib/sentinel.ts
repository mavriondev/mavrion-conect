/**
 * Sentinel Hub (Copernicus/ESA) — NDVI alta resolução 10m
 * Cadastro: https://www.sentinel-hub.com/
 * Secrets: SENTINEL_HUB_CLIENT_ID, SENTINEL_HUB_CLIENT_SECRET
 */

export interface SentinelNDVIResult {
  ndvi: number;
  /** null quando a fonte não devolveu a estatística (nunca preenchido com valor "padrão") */
  ndviMin: number | null;
  ndviMax: number | null;
  ndviStdDev: number | null;
  classificacao: string;
  variabilidade: string;
  resolucao: string;
  /** Mantido por compatibilidade: agora descreve o PERÍODO do composto, não uma "data da imagem". */
  dataImagem: string;
  /** Período (ISO) dos últimos 30 dias usado no composto de imagens com <=20% de nuvem. */
  periodoInicio: string;
  periodoFim: string;
  /** "poligono" = estatística só dentro da fazenda; "retangulo" = caixa ao redor (inclui vizinhos). */
  areaAmostrada: "poligono" | "retangulo";
  fonte: string;
  consultadoEm: string;
}

async function getSentinelToken(): Promise<string | null> {
  const clientId     = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(
      "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function getNDVISentinel(
  lat: number,
  lon: number,
  polygon?: number[][][] | null,
  /** Geometria completa (ex.: MultiPolygon). Se informada, a estatística usa ela inteira. */
  geometriaCompleta?: { type: string; coordinates: any } | null
): Promise<SentinelNDVIResult | null> {
  const token = await getSentinelToken();
  if (!token) return null;

  let bbox: [number, number, number, number];
  const usaPoligono = !!(geometriaCompleta || (polygon && polygon[0]?.length > 3));
  if (polygon && polygon[0]?.length > 0) {
    const lngs = polygon[0].map((c: number[]) => c[0]);
    const lats = polygon[0].map((c: number[]) => c[1]);
    bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  } else {
    const d = 0.02;
    bbox = [lon - d, lat - d, lon + d, lat + d];
  }

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 30 * 86400000);
  const toISO = (d: Date) => d.toISOString().split("T")[0];

  const evalscript = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04","B08","dataMask"] }], output: [{ id: "default", bands: 1 }, { id: "dataMask", bands: 1 }], mosaicking: "ORBIT" };
}
function evaluatePixel(samples) {
  let sum=0,min=1,max=-1,count=0,sumSq=0;
  for(let s of samples){
    if(s.dataMask===0)continue;
    const n=(s.B08-s.B04)/(s.B08+s.B04+0.0001);
    sum+=n; sumSq+=n*n; if(n<min)min=n; if(n>max)max=n; count++;
  }
  // Sem observação válida: devolve máscara 0 para o pixel sair da estatística
  // (antes devolvia NDVI 0, que virava "solo exposto" falso).
  if(count===0)return{default:[0],dataMask:[0]};
  const mean=sum/count;
  return{default:[mean],dataMask:[1]};
}`;

  try {
    const res = await fetch("https://sh.dataspace.copernicus.eu/api/v1/statistics", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          // Com polígono, a estatística é só do interior da fazenda (antes: caixa envolvente, que incluía vizinhos).
          bounds: usaPoligono
            ? { geometry: geometriaCompleta ?? { type: "Polygon", coordinates: polygon }, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } }
            : { bbox, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
          data: [{
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: { from: `${toISO(trintaDias)}T00:00:00Z`, to: `${toISO(hoje)}T23:59:59Z` },
              maxCloudCoverage: 20,
            },
          }],
        },
        aggregation: {
          timeRange: { from: `${toISO(trintaDias)}T00:00:00Z`, to: `${toISO(hoje)}T23:59:59Z` },
          aggregationInterval: { of: "P30D" },
          evalscript,
          resx: 0.0001, resy: 0.0001,
        },
        calculations: { default: { statistics: { default: { percentiles: { k: [25, 75] } } } } },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const data = await res.json() as any;
    const stats = data?.data?.[0]?.outputs?.default?.bands?.B0?.stats;
    if (!stats) return null;

    // Sem valores "padrão": se a média não veio, não há NDVI (antes virava 0,5 — dado inventado;
    // e um NDVI real igual a 0 também era trocado por 0,5 por causa do "||").
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
    const ndvi = num(stats.mean);
    if (ndvi === null) return null;
    const ndviMin = num(stats.min);
    const ndviMax = num(stats.max);
    const ndviStd = num(stats.stDev);

    const classificacao =
      ndvi >= 0.6 ? "Vegetação densa e saudável" :
      ndvi >= 0.4 ? "Vegetação moderada" :
      ndvi >= 0.2 ? "Vegetação esparsa" :
                    "Solo exposto ou vegetação muito baixa";

    const variabilidade = ndviStd === null
      ? "Variação interna não disponível"
      : ndviStd > 0.2
      ? "Alta variação interna — possível área degradada ou uso misto"
      : ndviStd > 0.1
      ? "Variação moderada"
      : "Vegetação homogênea";

    return {
      ndvi, ndviMin, ndviMax, ndviStdDev: ndviStd,
      classificacao, variabilidade,
      resolucao: "10m (Sentinel-2)",
      dataImagem: `${toISO(trintaDias)} a ${toISO(hoje)} (composto de 30 dias)`,
      periodoInicio: toISO(trintaDias),
      periodoFim: toISO(hoje),
      areaAmostrada: usaPoligono ? "poligono" : "retangulo",
      fonte: usaPoligono
        ? "Sentinel-2 L2A / Copernicus — média no polígono, imagens com ≤20% de nuvem"
        : "Sentinel-2 L2A / Copernicus — média numa caixa de ~4 km ao redor do ponto (inclui vizinhos)",
      consultadoEm: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
