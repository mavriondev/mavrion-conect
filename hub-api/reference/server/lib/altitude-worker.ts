import { pool } from "../db";

const OPEN_ELEVATION_URL = "https://api.open-elevation.com/api/v1/lookup";
const OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive";
const BATCH_SIZE = 300;
const LOCATIONS_PER_REQUEST = 80;
const DELAY_BETWEEN_REQUESTS_MS = 800;
const MAX_RETRIES = 3;
const CLIMATE_CONCURRENCY = 20;

let isRunning = false;
let shouldStop = false;
let stats = {
  processed: 0,
  errors: 0,
  total: 0,
  startedAt: null as Date | null,
  lastBatchAt: null as Date | null,
  status: "idle" as "idle" | "running" | "stopped" | "completed" | "error",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchElevation(
  locations: { latitude: number; longitude: number }[]
): Promise<{ latitude: number; longitude: number; elevation: number }[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPEN_ELEVATION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locations }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.log(`[Altitude] Rate limited, waiting 10s (attempt ${attempt}/${MAX_RETRIES})`);
          await sleep(10000);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.results || [];
    } catch (error: any) {
      if (attempt === MAX_RETRIES) throw error;
      console.log(`[Altitude] Request failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}. Retrying...`);
      await sleep(3000 * attempt);
    }
  }
  return [];
}

async function fetchClimate(
  lat: number,
  lon: number
): Promise<{ temp_media: number | null; precip_anual: number | null }> {
  try {
    const url = `${OPEN_METEO_URL}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&start_date=2024-01-01&end_date=2024-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=America/Sao_Paulo`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { temp_media: null, precip_anual: null };
    const data = await response.json();
    const temps: number[] = (data.daily?.temperature_2m_mean || []).filter((v: any) => v !== null);
    const precips: number[] = (data.daily?.precipitation_sum || []).filter((v: any) => v !== null);
    const temp_media = temps.length > 0 ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null;
    const precip_anual = precips.length > 0 ? precips.reduce((a: number, b: number) => a + b, 0) : null;
    return {
      temp_media: temp_media !== null ? Math.round(temp_media * 100) / 100 : null,
      precip_anual: precip_anual !== null ? Math.round(precip_anual * 100) / 100 : null,
    };
  } catch {
    return { temp_media: null, precip_anual: null };
  }
}

function computeCentroid(geometry: any): { latitude: number; longitude: number } | null {
  try {
    if (!geometry) return null;
    if (geometry.type === "Point") {
      return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
    }
    let coords: number[][] = [];
    if (geometry.type === "Polygon") {
      coords = geometry.coordinates[0];
    } else if (geometry.type === "MultiPolygon") {
      coords = geometry.coordinates.flat(2);
    } else if (geometry.type === "GeometryCollection" && geometry.geometries?.length) {
      return computeCentroid(geometry.geometries[0]);
    } else {
      return null;
    }
    if (!coords.length) return null;
    let sumLat = 0, sumLng = 0;
    for (const c of coords) {
      sumLng += c[0];
      sumLat += c[1];
    }
    return { latitude: sumLat / coords.length, longitude: sumLng / coords.length };
  } catch {
    return null;
  }
}

function computePerimeterKm(geometry: any): number | null {
  try {
    let coords: number[][] = [];
    if (geometry.type === "Polygon") {
      coords = geometry.coordinates[0];
    } else if (geometry.type === "MultiPolygon") {
      let total = 0;
      for (const poly of geometry.coordinates) {
        const ring = poly[0];
        for (let i = 0; i < ring.length - 1; i++) {
          total += haversineKm(ring[i][1], ring[i][0], ring[i + 1][1], ring[i + 1][0]);
        }
      }
      return Math.round(total * 100) / 100;
    } else {
      return null;
    }
    if (coords.length < 3) return null;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversineKm(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    }
    return Math.round(total * 100) / 100;
  } catch {
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

function computeSlope(
  points: { latitude: number; longitude: number }[],
  elevations: number[]
): number | null {
  if (points.length < 2 || elevations.length < 2) return null;
  let maxSlope = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = haversineKm(points[i].latitude, points[i].longitude, points[j].latitude, points[j].longitude) * 1000;
      if (dist < 1) continue;
      const dElev = Math.abs(elevations[i] - elevations[j]);
      const slope = (dElev / dist) * 100;
      if (slope > maxSlope) maxSlope = slope;
    }
  }
  return Math.round(maxSlope * 100) / 100;
}

function samplePolygonPoints(
  geometry: any,
  count: number = 5
): { latitude: number; longitude: number }[] {
  try {
    let coords: number[][] = [];
    if (geometry.type === "Polygon") {
      coords = geometry.coordinates[0];
    } else if (geometry.type === "MultiPolygon") {
      coords = geometry.coordinates[0][0];
    } else {
      const centroid = computeCentroid(geometry);
      return centroid ? [centroid] : [];
    }
    if (coords.length <= count) {
      return coords.map((c) => ({ latitude: c[1], longitude: c[0] }));
    }
    const step = Math.floor(coords.length / count);
    const sampled: { latitude: number; longitude: number }[] = [];
    for (let i = 0; i < count; i++) {
      const c = coords[i * step];
      sampled.push({ latitude: c[1], longitude: c[0] });
    }
    return sampled;
  } catch {
    return [];
  }
}

const climateCache = new Map<string, { temp_media: number | null; precip_anual: number | null }>();

function climateCacheKey(lat: number, lon: number): string {
  return `${(Math.round(lat * 10) / 10).toFixed(1)}_${(Math.round(lon * 10) / 10).toFixed(1)}`;
}

async function getClimateData(lat: number, lon: number): Promise<{ temp_media: number | null; precip_anual: number | null }> {
  const key = climateCacheKey(lat, lon);
  if (climateCache.has(key)) return climateCache.get(key)!;
  const data = await fetchClimate(lat, lon);
  climateCache.set(key, data);
  return data;
}

async function prefetchClimateParallel(
  centroids: { latitude: number; longitude: number }[]
): Promise<void> {
  const unique: { latitude: number; longitude: number }[] = [];
  const seen = new Set<string>();
  for (const c of centroids) {
    const key = climateCacheKey(c.latitude, c.longitude);
    if (!seen.has(key) && !climateCache.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }
  for (let i = 0; i < unique.length; i += CLIMATE_CONCURRENCY) {
    const chunk = unique.slice(i, i + CLIMATE_CONCURRENCY);
    await Promise.allSettled(chunk.map((c) => getClimateData(c.latitude, c.longitude)));
  }
}

async function processBatch(): Promise<number> {
  const result = await pool.query(
    `SELECT id, geometry FROM sicar_imoveis_cache
     WHERE alt_media IS NULL AND geometry IS NOT NULL
     ORDER BY id
     LIMIT $1`,
    [BATCH_SIZE]
  );

  if (result.rows.length === 0) return 0;

  const allLocations: {
    imovelId: number;
    centroid: { latitude: number; longitude: number } | null;
    perimetro: number | null;
    points: { latitude: number; longitude: number }[];
  }[] = [];

  const noGeomUpdates: number[] = [];

  for (const row of result.rows) {
    const geom = typeof row.geometry === "string" ? JSON.parse(row.geometry) : row.geometry;
    const centroid = computeCentroid(geom);
    if (!centroid) {
      noGeomUpdates.push(row.id);
      continue;
    }

    const perimetro = computePerimeterKm(geom);
    const samplePoints = samplePolygonPoints(geom, 5);
    if (samplePoints.length === 0) {
      samplePoints.push(centroid);
    }

    allLocations.push({ imovelId: row.id, centroid, perimetro, points: samplePoints });
  }

  if (noGeomUpdates.length > 0) {
    await Promise.allSettled(
      noGeomUpdates.map((id) =>
        pool.query(
          `UPDATE sicar_imoveis_cache SET alt_media = -9999, alt_min = -9999, alt_max = -9999,
           centroid_lat = NULL, centroid_lon = NULL, perimetro_km = NULL, declividade = NULL,
           temp_media = NULL, precip_anual = NULL WHERE id = $1`,
          [id]
        )
      )
    );
  }

  const locationChunks: {
    imovelId: number;
    pointIndex: number;
    latitude: number;
    longitude: number;
  }[] = [];

  for (const loc of allLocations) {
    for (let i = 0; i < loc.points.length; i++) {
      locationChunks.push({
        imovelId: loc.imovelId,
        pointIndex: i,
        latitude: loc.points[i].latitude,
        longitude: loc.points[i].longitude,
      });
    }
  }

  for (let chunkStart = 0; chunkStart < locationChunks.length; chunkStart += LOCATIONS_PER_REQUEST) {
    if (shouldStop) return -1;

    const chunk = locationChunks.slice(chunkStart, chunkStart + LOCATIONS_PER_REQUEST);
    const locations = chunk.map((c) => ({
      latitude: c.latitude,
      longitude: c.longitude,
    }));

    try {
      const elevations = await fetchElevation(locations);

      const elevationByImovel = new Map<number, { elevs: number[]; points: { latitude: number; longitude: number }[] }>();
      for (let i = 0; i < elevations.length; i++) {
        const entry = chunk[i];
        if (!elevationByImovel.has(entry.imovelId)) {
          elevationByImovel.set(entry.imovelId, { elevs: [], points: [] });
        }
        const data = elevationByImovel.get(entry.imovelId)!;
        data.elevs.push(elevations[i].elevation);
        data.points.push({ latitude: entry.latitude, longitude: entry.longitude });
      }

      const imovelIds = Array.from(elevationByImovel.keys());
      const centroids = imovelIds
        .map((id) => allLocations.find((l) => l.imovelId === id)?.centroid)
        .filter((c): c is { latitude: number; longitude: number } => c != null);

      await prefetchClimateParallel(centroids);

      const updatePromises = imovelIds.map(async (imovelId) => {
        const data = elevationByImovel.get(imovelId)!;
        const altMedia = data.elevs.reduce((a: number, b: number) => a + b, 0) / data.elevs.length;
        const altMin = Math.min(...data.elevs);
        const altMax = Math.max(...data.elevs);
        const declividade = computeSlope(data.points, data.elevs);

        const loc = allLocations.find((l) => l.imovelId === imovelId);
        let temp_media: number | null = null;
        let precip_anual: number | null = null;
        if (loc?.centroid) {
          const climate = await getClimateData(loc.centroid.latitude, loc.centroid.longitude);
          temp_media = climate.temp_media;
          precip_anual = climate.precip_anual;
        }

        return pool.query(
          `UPDATE sicar_imoveis_cache SET 
            alt_media = $1, alt_min = $2, alt_max = $3,
            centroid_lat = $4, centroid_lon = $5,
            perimetro_km = $6, declividade = $7,
            temp_media = $8, precip_anual = $9
           WHERE id = $10`,
          [
            Math.round(altMedia * 100) / 100,
            Math.round(altMin * 100) / 100,
            Math.round(altMax * 100) / 100,
            loc?.centroid ? Math.round(loc.centroid.latitude * 1000000) / 1000000 : null,
            loc?.centroid ? Math.round(loc.centroid.longitude * 1000000) / 1000000 : null,
            loc?.perimetro || null,
            declividade,
            temp_media,
            precip_anual,
            imovelId,
          ]
        );
      });

      await Promise.allSettled(updatePromises);

    } catch (error: any) {
      console.error(`[Altitude] Elevation API error: ${error.message}`);
      stats.errors++;
      await Promise.allSettled(
        chunk.map((entry) =>
          pool.query(
            `UPDATE sicar_imoveis_cache SET alt_media = -9999, alt_min = -9999, alt_max = -9999 WHERE id = $1`,
            [entry.imovelId]
          )
        )
      );
    }

    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  return allLocations.length;
}

export async function startAltitudeWorker(): Promise<void> {
  if (isRunning) {
    console.log("[Altitude] Worker already running");
    return;
  }

  isRunning = true;
  shouldStop = false;
  stats.startedAt = new Date();
  stats.status = "running";
  stats.processed = 0;
  stats.errors = 0;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM sicar_imoveis_cache WHERE alt_media IS NULL AND geometry IS NOT NULL`
  );
  stats.total = parseInt(countResult.rows[0].count);

  console.log(`[Altitude] Starting worker. ${stats.total} properties to process.`);

  try {
    while (!shouldStop) {
      const processed = await processBatch();
      if (processed === 0) {
        stats.status = "completed";
        console.log(`[Altitude] Worker completed. Total processed: ${stats.processed}`);
        break;
      }
      if (processed === -1) {
        stats.status = "stopped";
        console.log(`[Altitude] Worker stopped by user. Processed: ${stats.processed}`);
        break;
      }
      stats.processed += processed;
      stats.lastBatchAt = new Date();

      if (stats.processed % 1000 === 0) {
        console.log(`[Altitude] Progress: ${stats.processed}/${stats.total} (${((stats.processed / stats.total) * 100).toFixed(2)}%)`);
      }
    }
  } catch (error: any) {
    stats.status = "error";
    console.error(`[Altitude] Worker error: ${error.message}`);
  } finally {
    isRunning = false;
  }
}

export function stopAltitudeWorker(): void {
  shouldStop = true;
  console.log("[Altitude] Stop signal sent");
}

export function getAltitudeWorkerStats() {
  return {
    ...stats,
    isRunning,
    eta: stats.processed > 0 && stats.startedAt
      ? (() => {
          const elapsed = Date.now() - stats.startedAt.getTime();
          const rate = stats.processed / (elapsed / 1000);
          const remaining = stats.total - stats.processed;
          const etaSeconds = remaining / rate;
          const hours = Math.floor(etaSeconds / 3600);
          const minutes = Math.floor((etaSeconds % 3600) / 60);
          return `${hours}h ${minutes}m`;
        })()
      : null,
    rate: stats.processed > 0 && stats.startedAt
      ? Math.round(stats.processed / ((Date.now() - stats.startedAt.getTime()) / 60000))
      : 0,
  };
}

export async function autoStartIfPending(): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as pending FROM sicar_imoveis_cache WHERE alt_media IS NULL AND geometry IS NOT NULL`
    );
    const pending = parseInt(result.rows[0].pending);
    if (pending > 0) {
      console.log(`[Altitude] Auto-start: ${pending} imoveis pendentes. Iniciando worker em 30s...`);
      setTimeout(() => {
        startAltitudeWorker();
      }, 30000);
    } else {
      console.log(`[Altitude] Auto-start: nenhum imovel pendente. Worker nao iniciado.`);
    }
  } catch (error: any) {
    console.error(`[Altitude] Auto-start error: ${error.message}`);
  }
}
