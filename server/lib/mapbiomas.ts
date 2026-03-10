export interface MapBiomasResult {
  lat: number;
  lon: number;
  usoAtual: string;
  classeAtual: number;
  historico: Array<{
    ano: number;
    classe: number;
    descricao: string;
  }>;
  alertasDesmatamento: number;
  areaDesmatadaHa: number;
  bioma: string;
  fonte: string;
  consultadoEm: string;
}

const CLASSES_MAPBIOMAS: Record<number, string> = {
  3:  "Formação Florestal",
  4:  "Formação Savânica",
  5:  "Mangue",
  11: "Campo Alagado e Área Pantanosa",
  12: "Formação Campestre",
  15: "Pastagem",
  18: "Agricultura",
  19: "Lavoura Temporária",
  20: "Cana",
  21: "Mosaico de Usos",
  23: "Praia e Duna",
  24: "Área Urbana",
  25: "Outra Área não Vegetada",
  29: "Afloramento Rochoso",
  33: "Rio, Lago e Oceano",
  39: "Soja",
  40: "Arroz",
  41: "Outras Lavouras Temporárias",
  46: "Café",
  47: "Citrus",
  48: "Outras Lavouras Perenes",
  62: "Algodão",
};

const AUTH_URL = "https://plataforma.alerta.mapbiomas.org/api/auth";
const ALERTS_URL = "https://plataforma.alerta.mapbiomas.org/api/v1/validated_alerts";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const email = process.env.MAPBIOMAS_EMAIL;
  const password = process.env.MAPBIOMAS_PASSWORD;
  if (!email || !password) {
    console.warn("[MapBiomas] Credenciais não configuradas (MAPBIOMAS_EMAIL / MAPBIOMAS_PASSWORD)");
    return null;
  }

  try {
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.warn(`[MapBiomas] Auth falhou: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as any;
    const token = data?.token || data?.access_token || data?.auth_token || null;
    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + 3600000;
    }
    return token;
  } catch (err) {
    console.error("[MapBiomas] Erro na autenticação:", (err as Error).message);
    return null;
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function getUsoTerraMapBiomas(
  lat: number,
  lon: number
): Promise<MapBiomasResult | null> {
  try {
    const token = await getToken();

    let alertas: any[] = [];
    let totalArea = 0;

    if (token) {
      const now = new Date();
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setFullYear(now.getFullYear() - 2);

      const params = new URLSearchParams({
        start_year: String(twoYearsAgo.getFullYear()),
        start_month: String(twoYearsAgo.getMonth() + 1),
        end_year: String(now.getFullYear()),
        end_month: String(now.getMonth() + 1),
      });

      const res = await fetch(`${ALERTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);

      if (res?.ok) {
        const data = (await res.json()) as any;
        const allAlerts = Array.isArray(data) ? data : data?.data || data?.alerts || [];

        alertas = allAlerts.filter((a: any) => {
          const aLat = a.latitude || a.lat;
          const aLon = a.longitude || a.lon || a.lng;
          if (aLat == null || aLon == null) return false;
          return haversineKm(lat, lon, Number(aLat), Number(aLon)) <= 25;
        });

        totalArea = alertas.reduce((s: number, a: any) => s + (a.area_ha || a.areaHa || 0), 0);
      }
    }

    const classRes = await fetch(
      `https://api.mapbiomas.org/api/v1/classification?lat=${lat}&lng=${lon}&year=2023`,
      { signal: AbortSignal.timeout(8000) }
    ).catch(() => null);

    const classData = classRes?.ok ? (await classRes.json()) as any : null;
    const classeAtual = classData?.class_id || 15;
    const usoAtual = CLASSES_MAPBIOMAS[classeAtual] || "Não identificado";

    return {
      lat,
      lon,
      usoAtual,
      classeAtual,
      historico: [],
      alertasDesmatamento: alertas.length,
      areaDesmatadaHa: Math.round(totalArea * 100) / 100,
      bioma: classData?.biome || "Não identificado",
      fonte: "MapBiomas Alerta",
      consultadoEm: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[MapBiomas] Erro na consulta:", (err as Error).message);
    return null;
  }
}
