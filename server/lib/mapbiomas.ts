/**
 * MapBiomas — Uso e cobertura da terra (1985-atual)
 * API: https://plataforma.alerta.mapbiomas.org/api/graphql
 */

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

export async function getUsoTerraMapBiomas(
  lat: number,
  lon: number
): Promise<MapBiomasResult | null> {
  try {
    const query = `
      query {
        allMapbiomasAlerts(
          bbox: "${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}"
          limit: 10
        ) {
          areaHa
          detectedAt
        }
      }
    `;

    const alertRes = await fetch(
      "https://plataforma.alerta.mapbiomas.org/api/graphql",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(10000),
      }
    ).catch(() => null);

    const alertData = alertRes?.ok ? await alertRes.json() as any : null;
    const alertas = alertData?.data?.allMapbiomasAlerts || [];
    const areaDesmatada = alertas.reduce((s: number, a: any) => s + (a.areaHa || 0), 0);

    const classRes = await fetch(
      `https://api.mapbiomas.org/api/v1/classification?lat=${lat}&lng=${lon}&year=2023`,
      { signal: AbortSignal.timeout(8000) }
    ).catch(() => null);

    const classData = classRes?.ok ? await classRes.json() as any : null;
    const classeAtual = classData?.class_id || 15;
    const usoAtual = CLASSES_MAPBIOMAS[classeAtual] || "Não identificado";

    return {
      lat, lon,
      usoAtual,
      classeAtual,
      historico: [],
      alertasDesmatamento: alertas.length,
      areaDesmatadaHa: Math.round(areaDesmatada * 100) / 100,
      bioma: classData?.biome || "Não identificado",
      fonte: "MapBiomas",
      consultadoEm: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
