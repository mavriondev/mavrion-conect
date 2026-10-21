import { pool } from "../db";

const OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive";

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
    } else { return null; }
    if (!coords.length) return null;
    let sumLat = 0, sumLng = 0;
    for (const c of coords) { sumLng += c[0]; sumLat += c[1]; }
    return { latitude: sumLat / coords.length, longitude: sumLng / coords.length };
  } catch { return null; }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computePerimeterKm(geometry: any): number | null {
  try {
    let coords: number[][] = [];
    if (geometry.type === "Polygon") { coords = geometry.coordinates[0]; }
    else if (geometry.type === "MultiPolygon") {
      let total = 0;
      for (const poly of geometry.coordinates) {
        const ring = poly[0];
        for (let i = 0; i < ring.length - 1; i++) {
          total += haversineKm(ring[i][1], ring[i][0], ring[i + 1][1], ring[i + 1][0]);
        }
      }
      return Math.round(total * 100) / 100;
    } else { return null; }
    if (coords.length < 3) return null;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += haversineKm(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
    }
    return Math.round(total * 100) / 100;
  } catch { return null; }
}

function samplePolygonPoints(geometry: any, count: number = 5): { latitude: number; longitude: number }[] {
  try {
    let coords: number[][] = [];
    if (geometry.type === "Polygon") { coords = geometry.coordinates[0]; }
    else if (geometry.type === "MultiPolygon") { coords = geometry.coordinates[0][0]; }
    else { const c = computeCentroid(geometry); return c ? [c] : []; }
    if (coords.length <= count) return coords.map(c => ({ latitude: c[1], longitude: c[0] }));
    const step = Math.floor(coords.length / count);
    const sampled: { latitude: number; longitude: number }[] = [];
    for (let i = 0; i < count; i++) { const c = coords[i * step]; sampled.push({ latitude: c[1], longitude: c[0] }); }
    return sampled;
  } catch { return []; }
}

function computeSlope(points: { latitude: number; longitude: number }[], elevations: number[]): number | null {
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

const climateCache = new Map<string, { temp_media: number | null; precip_anual: number | null }>();
function climateCacheKey(lat: number, lon: number): string {
  return (Math.round(lat * 10) / 10).toFixed(1) + '_' + (Math.round(lon * 10) / 10).toFixed(1);
}

async function fetchClimate(lat: number, lon: number): Promise<{ temp_media: number | null; precip_anual: number | null }> {
  try {
    const url = OPEN_METEO_URL + '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) + '&start_date=2024-01-01&end_date=2024-12-31&daily=temperature_2m_mean,precipitation_sum&timezone=America/Sao_Paulo';
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { temp_media: null, precip_anual: null };
    const data = await response.json();
    const temps: number[] = (data.daily?.temperature_2m_mean || []).filter((v: any) => v !== null);
    const precips: number[] = (data.daily?.precipitation_sum || []).filter((v: any) => v !== null);
    const temp_media = temps.length > 0 ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null;
    const precip_anual = precips.length > 0 ? precips.reduce((a: number, b: number) => a + b, 0) : null;
    return { temp_media: temp_media !== null ? Math.round(temp_media * 100) / 100 : null, precip_anual: precip_anual !== null ? Math.round(precip_anual * 100) / 100 : null };
  } catch { return { temp_media: null, precip_anual: null }; }
}

async function getClimateData(lat: number, lon: number): Promise<{ temp_media: number | null; precip_anual: number | null }> {
  const key = climateCacheKey(lat, lon);
  if (climateCache.has(key)) return climateCache.get(key)!;
  const data = await fetchClimate(lat, lon);
  climateCache.set(key, data);
  return data;
}

export async function backfillGeoData(): Promise<void> {
  console.log('[Backfill] Starting geo data backfill for already-processed properties...');
  const BATCH = 200;
  let offset = 0;
  let total = 0;

  const countRes = await pool.query(
    `SELECT COUNT(*) FROM sicar_imoveis_cache WHERE alt_media IS NOT NULL AND alt_media != -9999 AND centroid_lat IS NULL AND geometry IS NOT NULL`
  );
  const pending = parseInt(countRes.rows[0].count);
  console.log('[Backfill] ' + pending + ' properties need geo backfill');

  while (true) {
    const result = await pool.query(
      `SELECT id, geometry, alt_media, alt_min, alt_max FROM sicar_imoveis_cache
       WHERE alt_media IS NOT NULL AND alt_media != -9999 AND centroid_lat IS NULL AND geometry IS NOT NULL
       ORDER BY id LIMIT $1`,
      [BATCH]
    );
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const geom = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry;
      const centroid = computeCentroid(geom);
      const perimetro = computePerimeterKm(geom);
      
      const points = samplePolygonPoints(geom, 5);
      const elevs = [row.alt_media, row.alt_min, row.alt_max].filter(v => v !== null && v !== -9999);
      let declividade: number | null = null;
      if (points.length >= 2 && row.alt_min !== null && row.alt_max !== null) {
        const distMax = haversineKm(points[0].latitude, points[0].longitude, points[points.length - 1].latitude, points[points.length - 1].longitude) * 1000;
        if (distMax > 1) {
          declividade = Math.round(((row.alt_max - row.alt_min) / distMax) * 100 * 100) / 100;
        }
      }

      let temp_media: number | null = null;
      let precip_anual: number | null = null;
      if (centroid) {
        const climate = await getClimateData(centroid.latitude, centroid.longitude);
        temp_media = climate.temp_media;
        precip_anual = climate.precip_anual;
      }

      await pool.query(
        `UPDATE sicar_imoveis_cache SET centroid_lat = $1, centroid_lon = $2, perimetro_km = $3, declividade = $4, temp_media = $5, precip_anual = $6 WHERE id = $7`,
        [
          centroid ? Math.round(centroid.latitude * 1000000) / 1000000 : null,
          centroid ? Math.round(centroid.longitude * 1000000) / 1000000 : null,
          perimetro, declividade, temp_media, precip_anual, row.id
        ]
      );
      total++;
    }

    console.log('[Backfill] Progress: ' + total + '/' + pending);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('[Backfill] Complete. ' + total + ' properties updated.');
}
