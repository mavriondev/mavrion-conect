import { db } from "../db";
import { sql } from "drizzle-orm";
import { fetchAnmProcessoGeometryFallback } from "./anm-fallback";

/**
 * Geometria do ativo (GeoJSON): coluna PostGIS `geom`; para MINA sem geom,
 * fallback no polígono SIGMINE espelhado pelo número do processo.
 * Usada pelo relatório PDF (mapa) e pelo catálogo de evidências (dentro/fora).
 */
export async function getAssetGeometry(assetId: number, orgId: number): Promise<any | null> {
  let row: any = null;
  try {
    const result = await db.execute(
      sql`SELECT ST_AsGeoJSON(geom) as geojson, type, anm_processo FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
    );
    row = (result as any).rows?.[0];
  } catch {
    // banco sem PostGIS/coluna geom — segue para o fallback ANM
    try {
      const fb = await db.execute(
        sql`SELECT type, anm_processo FROM assets WHERE id = ${assetId} AND org_id = ${orgId}`
      );
      row = (fb as any).rows?.[0];
    } catch {
      return null;
    }
  }
  if (row?.geojson) {
    try { return JSON.parse(row.geojson); } catch { return null; }
  }
  if (row?.type === "MINA" && row?.anm_processo) {
    try {
      const fb = await fetchAnmProcessoGeometryFallback(row.anm_processo.replace(/[^0-9/]/g, ""));
      if (fb?.geometry) return fb.geometry;
    } catch {}
  }
  return null;
}
