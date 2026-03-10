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

const GRAPHQL_URL = "https://plataforma.alerta.mapbiomas.org/api/v2/graphql";

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
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `mutation { signIn(email: "${email}", password: "${password}") { token } }`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[MapBiomas] Auth HTTP falhou: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as any;
    const token = data?.data?.signIn?.token;
    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + 3600000;
      console.log("[MapBiomas] Token obtido com sucesso");
    } else {
      const errors = data?.errors?.map((e: any) => e.message).join("; ") || "resposta sem token";
      console.warn(`[MapBiomas] Auth falhou: ${errors}`);
    }
    return token || null;
  } catch (err) {
    console.error("[MapBiomas] Erro na autenticação:", (err as Error).message);
    return null;
  }
}

export async function getUsoTerraMapBiomas(
  lat: number,
  lon: number,
  carCode?: string
): Promise<MapBiomasResult | null> {
  try {
    const token = await getToken();

    let alertCount = 0;
    let totalArea = 0;
    let bioma = "Não identificado";

    if (token) {
      let filterArg: string;
      if (carCode) {
        filterArg = `propertyCodes: ["${carCode}"]`;
      } else {
        const delta = 0.02;
        const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];
        filterArg = `boundingBox: [${bbox.join(",")}]`;
      }

      const query = `{
        alerts(${filterArg}, limit: 100) {
          collection {
            alertCode
            areaHa
            detectedAt
            statusName
            crossedBiomesList
          }
        }
      }`;

      const res = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null);

      if (res?.ok) {
        const data = (await res.json()) as any;
        const collection = data?.data?.alerts?.collection || [];

        alertCount = collection.length;
        totalArea = collection.reduce(
          (s: number, a: any) => s + (a.areaHa || 0), 0
        );

        const firstAlert = collection[0];
        if (firstAlert?.crossedBiomesList) {
          try {
            const biomes = typeof firstAlert.crossedBiomesList === "string"
              ? JSON.parse(firstAlert.crossedBiomesList)
              : firstAlert.crossedBiomesList;
            if (Array.isArray(biomes) && biomes.length > 0) {
              bioma = biomes[0]?.name || biomes[0] || bioma;
            }
          } catch {}
        }

        if (data?.errors) {
          console.warn("[MapBiomas] GraphQL warnings:", data.errors.map((e: any) => e.message).join("; "));
        }
      } else if (res) {
        console.warn(`[MapBiomas] Alerts query falhou: ${res.status}`);
      }
    }

    const classRes = await fetch(
      `https://api.mapbiomas.org/api/v1/classification?lat=${lat}&lng=${lon}&year=2023`,
      { signal: AbortSignal.timeout(8000) }
    ).catch(() => null);

    const classData = classRes?.ok ? (await classRes.json()) as any : null;
    const classeAtual = classData?.class_id || 15;
    const usoAtual = CLASSES_MAPBIOMAS[classeAtual] || "Não identificado";
    if (classData?.biome && bioma === "Não identificado") {
      bioma = classData.biome;
    }

    return {
      lat,
      lon,
      usoAtual,
      classeAtual,
      historico: [],
      alertasDesmatamento: alertCount,
      areaDesmatadaHa: Math.round(totalArea * 100) / 100,
      bioma,
      fonte: "MapBiomas Alerta",
      consultadoEm: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[MapBiomas] Erro na consulta:", (err as Error).message);
    return null;
  }
}
