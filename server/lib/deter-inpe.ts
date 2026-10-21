export interface DeterAlerta {
  data: string;
  areaHa: number;
  classe: string;
  municipio: string;
  uf: string;
  satelite: string;
}

export interface DeterResult {
  totalAlertas: number;
  areaDesmatadaHa: number;
  alertas: DeterAlerta[];
  fonte: string;
  consultadoEm: string;
}

const BASE_URL = "https://terrabrasilis.dpi.inpe.br/geoserver/ows";

const LAYERS = [
  "deter-amz:deter_amz",
  "deter-cerrado-nb:deter_cerrado",
];

async function fetchDeterLayer(
  layer: string,
  lat: number,
  lon: number,
  radius: number = 0.1,
  maxFeatures: number = 50
): Promise<DeterAlerta[]> {
  const bbox = `${lon - radius},${lat - radius},${lon + radius},${lat + radius}`;
  const params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: layer,
    outputFormat: "application/json",
    maxFeatures: String(maxFeatures),
    srsName: "EPSG:4674",
    CQL_FILTER: `BBOX(geom,${bbox})`,
  });

  const res = await fetch(`${BASE_URL}?${params}`, {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return [];

  const data = (await res.json()) as any;
  const features = data?.features || [];

  return features.map((f: any) => {
    const p = f.properties || {};
    const areaKm2 = p.areamunkm || p.areatotalkm || 0;
    return {
      data: p.view_date || p.date || "",
      areaHa: Math.round(areaKm2 * 100 * 100) / 100,
      classe: p.classname || "DESMATAMENTO",
      municipio: p.municipality || p.municipio || "",
      uf: p.uf || "",
      satelite: p.satellite || p.sensor || "",
    };
  });
}

export async function consultarDeterINPE(
  lat: number,
  lon: number
): Promise<DeterResult | null> {
  try {
    const results = await Promise.allSettled(
      LAYERS.map((layer) => fetchDeterLayer(layer, lat, lon))
    );

    const allAlertas: DeterAlerta[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        allAlertas.push(...r.value);
      }
    }

    allAlertas.sort((a, b) => (b.data > a.data ? 1 : -1));

    const areaTotal = allAlertas.reduce((s, a) => s + a.areaHa, 0);

    return {
      totalAlertas: allAlertas.length,
      areaDesmatadaHa: Math.round(areaTotal * 100) / 100,
      alertas: allAlertas.slice(0, 20),
      fonte: "DETER/INPE (Amazônia + Cerrado)",
      consultadoEm: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[DETER] Erro na consulta:", (err as Error).message);
    return null;
  }
}
