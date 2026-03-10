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
  transicoes: Array<{
    de: string;
    para: string;
    ano: number;
  }>;
  alertasDesmatamento: number;
  areaDesmatadaHa: number;
  bioma: string;
  bacia: string;
  municipio: string;
  estado: string;
  embargoMapbiomas: number;
  propriedade: {
    areaHa: number;
    tipo: string;
    alertasNaPropriedade: number;
  } | null;
  fonte: string;
  consultadoEm: string;
}

const CLASSES_MAPBIOMAS: Record<number, string> = {
  1:  "Floresta",
  3:  "Formação Florestal",
  4:  "Formação Savânica",
  5:  "Mangue",
  6:  "Floresta Alagável",
  9:  "Silvicultura",
  11: "Campo Alagado e Área Pantanosa",
  12: "Formação Campestre",
  13: "Outra Formação não Florestal",
  14: "Agropecuária",
  15: "Pastagem",
  18: "Agricultura",
  19: "Lavoura Temporária",
  20: "Cana",
  21: "Mosaico de Usos",
  22: "Área não Vegetada",
  23: "Praia e Duna",
  24: "Área Urbana",
  25: "Outra Área não Vegetada",
  26: "Corpo d'Água",
  27: "Não Observado",
  29: "Afloramento Rochoso",
  30: "Mineração",
  31: "Aquicultura",
  32: "Apicum",
  33: "Rio, Lago e Oceano",
  35: "Dendê",
  36: "Lavoura Perene",
  39: "Soja",
  40: "Arroz",
  41: "Outras Lavouras Temporárias",
  46: "Café",
  47: "Citrus",
  48: "Outras Lavouras Perenes",
  49: "Restinga Arborizada",
  50: "Restinga Herbácea",
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

async function gqlQuery(token: string, query: string): Promise<any> {
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.warn("[MapBiomas] GraphQL HTTP:", res.status);
      return null;
    }
    const data = await res.json() as any;
    if (data?.errors && !data?.data) {
      console.warn("[MapBiomas] GraphQL error:", data.errors.map((e: any) => e.message).join("; "));
      return null;
    }
    if (data?.errors) {
      console.warn("[MapBiomas] GraphQL partial:", data.errors.map((e: any) => e.message).join("; "));
    }
    return data?.data || null;
  } catch (err) {
    console.warn("[MapBiomas] GraphQL fetch error:", (err as Error).message);
    return null;
  }
}

function parseHistorico(history: Record<string, number>): {
  historico: MapBiomasResult["historico"];
  transicoes: MapBiomasResult["transicoes"];
  classeAtual: number;
  usoAtual: string;
} {
  const entries = Object.entries(history)
    .map(([key, val]) => ({ ano: parseInt(key.replace("classification_", "")), classe: val }))
    .filter(e => !isNaN(e.ano))
    .sort((a, b) => a.ano - b.ano);

  const historico = entries.map(e => ({
    ano: e.ano,
    classe: e.classe,
    descricao: CLASSES_MAPBIOMAS[e.classe] || `Classe ${e.classe}`,
  }));

  const transicoes: MapBiomasResult["transicoes"] = [];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].classe !== entries[i - 1].classe) {
      transicoes.push({
        de: CLASSES_MAPBIOMAS[entries[i - 1].classe] || `Classe ${entries[i - 1].classe}`,
        para: CLASSES_MAPBIOMAS[entries[i].classe] || `Classe ${entries[i].classe}`,
        ano: entries[i].ano,
      });
    }
  }

  const last = entries[entries.length - 1];
  const classeAtual = last?.classe || 0;
  const usoAtual = CLASSES_MAPBIOMAS[classeAtual] || "Não identificado";

  return { historico, transicoes, classeAtual, usoAtual };
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
    let bacia = "";
    let municipio = "";
    let estado = "";
    let historico: MapBiomasResult["historico"] = [];
    let transicoes: MapBiomasResult["transicoes"] = [];
    let classeAtual = 0;
    let usoAtual = "Não identificado";
    let embargoMapbiomas = 0;
    let propriedade: MapBiomasResult["propriedade"] = null;

    if (token) {
      const delta = 0.005;
      const pointInfoQuery = `{
        pointInformation(boundingBox: {
          swLat: ${lat - delta}, swLng: ${lon - delta},
          neLat: ${lat + delta}, neLng: ${lon + delta}
        }) {
          historyCoverage { history }
          territories { name categoryName }
        }
      }`;

      let alertFilterArg: string;
      if (carCode) {
        alertFilterArg = `propertyCodes: ["${carCode}"]`;
      } else {
        const aDelta = 0.02;
        alertFilterArg = `boundingBox: [${lon - aDelta}, ${lat - aDelta}, ${lon + aDelta}, ${lat + aDelta}]`;
      }

      const alertsQuery = `{
        alerts(${alertFilterArg}, limit: 100) {
          collection {
            alertCode
            areaHa
            detectedAt
            statusName
          }
        }
      }`;

      let ruralPropQuery: string | null = null;
      if (carCode) {
        ruralPropQuery = `{
          ruralProperty(propertyCode: "${carCode}") {
            propertyCode
            areaHa
            propertyType
            stateAcronym
            alerts { alertCode areaHa detectedAt statusName }
          }
        }`;
      }

      const promises: Promise<any>[] = [
        gqlQuery(token, pointInfoQuery),
        gqlQuery(token, alertsQuery),
      ];
      if (ruralPropQuery) {
        promises.push(gqlQuery(token, ruralPropQuery));
      }

      const results = await Promise.allSettled(promises);

      const pointData = results[0].status === "fulfilled" ? results[0].value : null;
      const alertsData = results[1].status === "fulfilled" ? results[1].value : null;
      const ruralData = results.length > 2 && results[2].status === "fulfilled" ? results[2].value : null;

      if (pointData?.pointInformation) {
        const pi = pointData.pointInformation;

        if (pi.historyCoverage?.history) {
          const parsed = parseHistorico(pi.historyCoverage.history);
          historico = parsed.historico;
          transicoes = parsed.transicoes;
          classeAtual = parsed.classeAtual;
          usoAtual = parsed.usoAtual;
        }

        if (pi.territories && Array.isArray(pi.territories)) {
          for (const t of pi.territories) {
            const cat = t.categoryName?.toLowerCase() || "";
            if (cat.includes("bioma") && bioma === "Não identificado") bioma = t.name;
            else if (cat.includes("município") || cat.includes("municipio")) municipio = t.name;
            else if (cat.includes("estado")) estado = t.name;
            else if (cat.includes("bacia") && cat.includes("1") && !bacia) bacia = t.name;
          }
        }
      }

      if (alertsData?.alerts?.collection) {
        const collection = alertsData.alerts.collection;
        alertCount = collection.length;
        totalArea = collection.reduce((s: number, a: any) => s + (a.areaHa || 0), 0);
      }

      if (ruralData?.ruralProperty) {
        const rp = ruralData.ruralProperty;
        const rpAlerts = rp.alerts || [];
        propriedade = {
          areaHa: rp.areaHa || 0,
          tipo: rp.propertyType || "Desconhecido",
          alertasNaPropriedade: rpAlerts.length,
        };
        if (rpAlerts.length > 0 && alertCount === 0) {
          alertCount = rpAlerts.length;
          totalArea = rpAlerts.reduce((s: number, a: any) => s + (a.areaHa || 0), 0);
        }
      }
    }

    const gotRealData = historico.length > 0 || bioma !== "Não identificado" || alertCount > 0 || propriedade !== null;
    if (!token || !gotRealData) {
      console.warn("[MapBiomas] Nenhum dado real obtido");
      return null;
    }

    return {
      lat,
      lon,
      usoAtual,
      classeAtual,
      historico,
      transicoes,
      alertasDesmatamento: alertCount,
      areaDesmatadaHa: Math.round(totalArea * 100) / 100,
      bioma,
      bacia,
      municipio,
      estado,
      embargoMapbiomas,
      propriedade,
      fonte: "MapBiomas Alerta + Cobertura",
      consultadoEm: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[MapBiomas] Erro na consulta:", (err as Error).message);
    return null;
  }
}
