/**
 * Zona UTM adequada à longitude/latitude do ativo, para cálculo métrico de
 * área/interseção no PostGIS. Substitui o EPSG:32723 fixo (zona 23S), que só
 * é correto entre 48°W e 42°W no hemisfério sul — errado para ativos do resto
 * do Brasil (zonas 18–25).
 */

/** Zona UTM (1–60) a partir da longitude em graus. */
export function utmZoneFromLon(lon: number): number {
  if (!Number.isFinite(lon)) return 23; // fallback: zona 23 (centro-leste do Brasil)
  const z = Math.floor((lon + 180) / 6) + 1;
  return Math.min(60, Math.max(1, z));
}

/** SRID EPSG WGS84/UTM: 326xx no hemisfério norte, 327xx no sul. */
export function utmSridFromLonLat(lon: number, lat: number): number {
  const base = Number.isFinite(lat) && lat >= 0 ? 32600 : 32700;
  return base + utmZoneFromLon(lon);
}

/**
 * Fragmento SQL (PostGIS) que calcula o SRID UTM adequado a partir do
 * centróide de uma expressão de geometria em WGS84. Usar via sql.raw() num
 * CTE (`SELECT ... AS srid`) quando o centróide não está disponível no JS.
 */
export function utmSridSqlExpr(geomExpr: string): string {
  return `((CASE WHEN ST_Y(ST_Centroid(${geomExpr})) >= 0 THEN 32600 ELSE 32700 END) ` +
    `+ LEAST(60, GREATEST(1, (FLOOR((ST_X(ST_Centroid(${geomExpr})) + 180) / 6))::int + 1)))`;
}
