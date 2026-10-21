import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assets, mavrionCafRegistros } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";
import { getCached, setCached } from "../cache";
import { getOrgId } from "../lib/tenant";
import { logApiError } from "../lib/api-error-logger";
import { enriquecerFazenda, consultarSoloSoilGrids } from '../enrichment/agro';
import { consultarDeterINPE } from "../lib/deter-inpe";
import { getUsoTerraMapBiomas } from "../lib/mapbiomas";
import { utmSridSqlExpr } from "../lib/utm";
import { executarDueDiligenceFundiaria } from "../lib/due-diligence-fundiaria";

const ANM_MAPSERVER_URL = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query";
const CAR_PUBLIC_URL = "https://consultapublica.car.gov.br/publico/imoveis/index";
const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/wfs";
const ELEVATION_API = "https://api.opentopodata.org/v1/srtm30m";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const UF_LIST = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

const MAVRION_API_URL = "https://api.mavrionconnect.com.br";
let _mavrionApiToken: string | null = null;
let _mavrionApiTokenExp: number = 0;

async function getMavrionApiToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && _mavrionApiToken && Date.now() < _mavrionApiTokenExp) return _mavrionApiToken;
  const user = process.env.MAVRION_API_USER;
  const pass = process.env.MAVRION_API_PASS;
  if (!user || !pass) {
    console.error("[Mavrion API] MAVRION_API_USER/MAVRION_API_PASS not configured");
    return null;
  }
  try {
    const resp = await fetch(`${MAVRION_API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    _mavrionApiToken = data.token || data.accessToken || null;
    _mavrionApiTokenExp = Date.now() + 6 * 24 * 60 * 60 * 1000;
    return _mavrionApiToken;
  } catch {
    return null;
  }
}

async function mavrionApiFetch(path: string, timeout = 15000): Promise<any | null> {
  const token = await getMavrionApiToken();
  if (!token) {
    console.warn("[Mavrion API] No token available — cannot fetch", path);
    return null;
  }
  try {
    const resp = await fetch(`${MAVRION_API_URL}${path}`, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
    if (resp.status === 401 || resp.status === 403) {
      const refreshedToken = await getMavrionApiToken(true);
      if (!refreshedToken) return null;
      const retryResp = await fetch(`${MAVRION_API_URL}${path}`, {
        headers: { "Authorization": `Bearer ${refreshedToken}` },
        signal: AbortSignal.timeout(timeout),
      });
      if (!retryResp.ok) {
        console.warn(`[Mavrion API] Retry failed: ${retryResp.status} for ${path}`);
        return null;
      }
      return await retryResp.json();
    }
    if (!resp.ok) {
      console.warn(`[Mavrion API] HTTP ${resp.status} for ${path}`);
      return null;
    }
    return await resp.json();
  } catch (err: any) {
    console.warn(`[Mavrion API] Fetch error for ${path}:`, err.message || err);
    return null;
  }
}

function apiRecordToFeature(record: any): any {
  return {
    type: "Feature",
    id: record.cod_imovel || record.id,
    geometry: record.geometry || null,
    properties: {
      cod_imovel: record.cod_imovel,
      municipio: record.municipio,
      uf: record.uf,
      num_area: record.num_area,
      ind_status: record.ind_status,
      ind_tipo: record.ind_tipo,
      dat_criacao: record.dat_criacao,
      data_atualizacao: record.data_atualizacao,
      condicao: record.condicao,
      cod_municipio_ibge: record.cod_municipio_ibge,
      m_fiscal: record.m_fiscal,
      alt_media: record.alt_media ?? null,
      declividade: record.declividade ?? null,
      argila_media: record.argila_pct ?? record.argila_media ?? null,
    },
  };
}

function osmToGeoJSON(elements: any[]): any {
  const features: any[] = [];
  for (const el of elements) {
    if (!el.geometry && !el.lat) continue;
    let geom: any = null;
    if (el.type === "way" && el.geometry) {
      const coords = el.geometry.map((n: any) => [n.lon, n.lat]);
      geom = { type: "LineString", coordinates: coords };
    } else if (el.type === "node" && el.lat != null) {
      geom = { type: "Point", coordinates: [el.lon, el.lat] };
    } else if (el.type === "relation" && el.members) {
      const memberLines: number[][][] = [];
      for (const m of el.members) {
        if (m.geometry && m.geometry.length > 1) {
          memberLines.push(m.geometry.map((n: any) => [n.lon, n.lat]));
        }
      }
      if (memberLines.length === 1) {
        geom = { type: "LineString", coordinates: memberLines[0] };
      } else if (memberLines.length > 1) {
        geom = { type: "MultiLineString", coordinates: memberLines };
      }
    }
    if (geom) {
      features.push({
        type: "Feature",
        properties: el.tags || {},
        geometry: geom,
      });
    }
  }
  return { type: "FeatureCollection", features };
}

async function fetchOSMWater(centLat: number, centLng: number, padDeg: number = 0.15): Promise<any> {
  const cacheKey = `osm_water:${centLat.toFixed(3)},${centLng.toFixed(3)},${padDeg}`;
  const cached = await getCached<any>("geo", cacheKey);
  if (cached) return cached;

  const south = centLat - padDeg, north = centLat + padDeg;
  const west = centLng - padDeg, east = centLng + padDeg;
  const bb = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:15];(way["waterway"~"river|stream|canal"](${bb});relation["waterway"~"river|stream"](${bb});way["natural"~"water|lake|reservoir"](${bb});relation["natural"~"water|lake|reservoir"](${bb}););out geom 100;`;
  try {
    const r = await fetch(OVERPASS_API, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    const text = await r.text();
    if (text.startsWith("<")) return { type: "FeatureCollection", features: [] };
    const data = JSON.parse(text);
    const geojson = osmToGeoJSON(data.elements || []);
    await setCached("geo", cacheKey, geojson);
    return geojson;
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

async function fetchOSMPower(centLat: number, centLng: number, padDeg: number = 0.15): Promise<any> {
  const cacheKey = `osm_power:${centLat.toFixed(3)},${centLng.toFixed(3)},${padDeg}`;
  const cached = await getCached<any>("geo", cacheKey);
  if (cached) return cached;

  const south = centLat - padDeg, north = centLat + padDeg;
  const west = centLng - padDeg, east = centLng + padDeg;
  const bb = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:15];(way["power"~"line|minor_line|cable"](${bb});node["power"~"tower|pole|substation"](${bb}););out geom 100;`;
  try {
    const r = await fetch(OVERPASS_API, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { type: "FeatureCollection", features: [] };
    const text = await r.text();
    if (text.startsWith("<")) return { type: "FeatureCollection", features: [] };
    const data = JSON.parse(text);
    const geojson = osmToGeoJSON(data.elements || []);
    await setCached("geo", cacheKey, geojson);
    return geojson;
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

function sanitizeAnmInput(val: unknown, pattern: RegExp): string | null {
  if (!val || typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/'/g, "''");
  if (!pattern.test(cleaned)) return null;
  return cleaned;
}

const ACCENT_PAIRS: Record<string, string> = {
  "A": "_", "Á": "_", "À": "_", "Â": "_", "Ã": "_", "Ä": "_",
  "E": "_", "É": "_", "È": "_", "Ê": "_", "Ë": "_",
  "I": "_", "Í": "_", "Ì": "_", "Î": "_", "Ï": "_",
  "O": "_", "Ó": "_", "Ò": "_", "Ô": "_", "Õ": "_", "Ö": "_",
  "U": "_", "Ú": "_", "Ù": "_", "Û": "_", "Ü": "_",
  "C": "_", "Ç": "_",
};

function fullyInsensitiveLike(term: string): string {
  return Array.from(term.toUpperCase()).map(ch => ACCENT_PAIRS[ch] || ch).join("");
}

function buildAccentAwareLike(field: string, term: string, wrap: boolean = true): string {
  const upper = term.toUpperCase();
  const stripped = upper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const hasAccents = stripped !== upper;
  const pct = wrap ? "%" : "";
  if (hasAccents) {
    let wildcard = "";
    for (let i = 0; i < upper.length; i++) {
      const norm = upper[i].normalize("NFD");
      wildcard += norm.length > 1 ? "_" : upper[i];
    }
    return `${field} LIKE '${pct}${wildcard}${pct}'`;
  }
  const vowelCount = (upper.match(/[AEIOU]/g) || []).length;
  if (vowelCount <= 3) {
    const pattern = fullyInsensitiveLike(upper);
    return `${field} LIKE '${pct}${pattern}${pct}'`;
  }
  return `(${field} LIKE '${pct}${upper}${pct}' OR ${field} LIKE '${pct}${fullyInsensitiveLike(upper)}${pct}')`;
}

const ANM_PATTERNS = {
  uf: /^[A-Z]{2}$/,
  substancia: /^[A-ZÀ-Ü0-9 ,.-]{1,100}$/i,
  fase: /^[A-ZÀ-Ü0-9 ]{3,60}$/i,
  empresa: /^[A-ZÀ-Ü0-9 &.,/()-]{2,200}$/i,
  processo: /^[0-9/.]{3,30}$/,
  uso: /^[A-ZÀ-ü0-9 ,.\-çãõâêîôûáéíóú]{1,100}$/i,
  ano: /^[0-9]{4}$/,
  ultEvento: /^[A-ZÀ-Ü0-9 ,./()-]{2,200}$/i,
};

// Fallback: geoportal ANM bloqueia (WAF 403) consultas com aspas no `where`.
// Nesses casos, consulta a base SIGMINE espelhada na API Mavrion.
function mavrionRowToAnmAttrs(r: any): any {
  return {
    PROCESSO: r.processo,
    NOME: r.nome,
    FASE: r.fase,
    SUBS: r.subs,
    AREA_HA: r.area_ha,
    UF: r.uf,
    ULT_EVENTO: r.ult_evento,
    DSProcesso: r.ds_processo,
    ANO: r.ano,
    USO: r.uso,
    ID: r.id_anm || r.id,
  };
}

function normalizeForCompare(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// ── Filtro por município: cruza polígono do processo com a malha do IBGE ──
const _municipioGeomCache: Record<string, any> = {};
async function fetchMunicipioPolygon(codigoIbge: string): Promise<any | null> {
  if (_municipioGeomCache[codigoIbge]) return _municipioGeomCache[codigoIbge];
  try {
    const resp = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${codigoIbge}?formato=application/vnd.geo+json`,
      { signal: AbortSignal.timeout(20000) },
    );
    if (!resp.ok) return null;
    const gj = await resp.json() as any;
    const geom = gj?.features?.[0]?.geometry
      || (gj?.type === "Polygon" || gj?.type === "MultiPolygon" ? gj : null);
    if (!geom) return null;
    _municipioGeomCache[codigoIbge] = geom;
    return geom;
  } catch {
    return null;
  }
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeom(pt: [number, number], geom: any): boolean {
  if (!geom || !geom.coordinates) return false;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const poly of polys) {
    if (poly.length > 0 && pointInRing(pt, poly[0])) {
      // dentro do anel externo; verifica buracos
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(pt, poly[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

// Distância aproximada em km entre dois pontos [lng, lat] (haversine)
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Bbox de uma geometria expandido por um raio em km (para consulta espacial)
function expandedBboxFromGeom(geom: any, radiusKm: number): string | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
      return;
    }
    for (const c of coords) traverse(c);
  }
  if (geom?.coordinates) traverse(geom.coordinates);
  else if (geom?.rings) traverse(geom.rings);
  if (!isFinite(minLng)) return null;
  const dLat = radiusKm / 111.32;
  const midLat = (minLat + maxLat) / 2;
  const dLng = radiusKm / (111.32 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  return `${minLng - dLng},${minLat - dLat},${maxLng + dLng},${maxLat + dLat}`;
}

function geomCentroidPt(geom: any): [number, number] | null {
  if (!geom) return null;
  let sumLng = 0, sumLat = 0, count = 0;
  function traverse(coords: any) {
    if (typeof coords[0] === "number") { sumLng += coords[0]; sumLat += coords[1]; count++; return; }
    for (const c of coords) traverse(c);
  }
  if (geom.rings) { traverse(geom.rings); }
  else if (geom.coordinates) { traverse(geom.coordinates); }
  return count > 0 ? [sumLng / count, sumLat / count] : null;
}

// ── Resolução de município por centroide: malha municipal do IBGE por UF ──
const _ufMalhaMunicipiosCache: Record<string, any | null> = {};
async function fetchUfMalhaMunicipios(uf: string): Promise<any | null> {
  const key = uf.toUpperCase();
  if (key in _ufMalhaMunicipiosCache) return _ufMalhaMunicipiosCache[key];
  try {
    const resp = await fetch(
      `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${key}?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=minima`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!resp.ok) { _ufMalhaMunicipiosCache[key] = null; return null; }
    const gj = await resp.json() as any;
    const fc = gj?.type === "FeatureCollection" && Array.isArray(gj.features) ? gj : null;
    _ufMalhaMunicipiosCache[key] = fc;
    return fc;
  } catch {
    _ufMalhaMunicipiosCache[key] = null;
    return null;
  }
}

const _ufMunicipioNomesCache: Record<string, Record<string, string>> = {};
async function fetchUfMunicipioNomes(uf: string): Promise<Record<string, string>> {
  const key = uf.toUpperCase();
  if (_ufMunicipioNomesCache[key]) return _ufMunicipioNomesCache[key];
  const map: Record<string, string> = {};
  try {
    if (_geoDb) {
      try {
        const rows = await _geoDb.execute(sql`SELECT nome, codigo_ibge FROM municipios_br WHERE uf = ${key}`);
        for (const r of (rows.rows as any[])) {
          if (r.codigo_ibge) map[String(r.codigo_ibge)] = r.nome;
        }
      } catch {}
    }
    if (Object.keys(map).length === 0) {
      const resp = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${key}/municipios`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (resp.ok) {
        const data = await resp.json() as any[];
        for (const m of data) {
          if (m.id) map[String(m.id)] = m.nome;
        }
      }
    }
  } catch {}
  if (Object.keys(map).length > 0) _ufMunicipioNomesCache[key] = map;
  return map;
}

function nearestRingDistanceKm(pt: [number, number], geom: any): number {
  let min = Infinity;
  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      const d = haversineKm(pt, [coords[0], coords[1]]);
      if (d < min) min = d;
      return;
    }
    for (const c of coords) traverse(c);
  }
  if (geom?.coordinates) traverse(geom.coordinates);
  return min;
}

// Dado um ponto [lng, lat] e a UF, resolve o município via ponto-no-polígono
// na malha do IBGE; se cair fora (precisão da malha), usa o polígono mais próximo (< 15 km)
async function resolveMunicipioFromPoint(pt: [number, number], uf: string): Promise<{ nome: string; codigoIbge: string } | null> {
  const malha = await fetchUfMalhaMunicipios(uf);
  if (!malha?.features?.length) return null;
  let codarea: string | null = null;
  for (const feat of malha.features) {
    if (feat.geometry && pointInGeom(pt, feat.geometry)) {
      codarea = String(feat.properties?.codarea || "");
      break;
    }
  }
  if (!codarea) {
    let best: { cod: string; dist: number } | null = null;
    for (const feat of malha.features) {
      if (!feat.geometry) continue;
      const d = nearestRingDistanceKm(pt, feat.geometry);
      if (!best || d < best.dist) best = { cod: String(feat.properties?.codarea || ""), dist: d };
    }
    if (best && best.dist <= 15) codarea = best.cod;
  }
  if (!codarea) return null;
  const nomes = await fetchUfMunicipioNomes(uf);
  const nome = nomes[codarea];
  return nome ? { nome, codigoIbge: codarea } : null;
}

// Busca a geometria (GeoJSON) de um processo — geoportal ANM com fallback Mavrion
async function fetchProcessoGeometry(cleanProcesso: string): Promise<any | null> {
  try {
    const params = new URLSearchParams({
      where: `PROCESSO='${cleanProcesso}'`,
      outFields: "PROCESSO",
      returnGeometry: "true",
      geometryType: "esriGeometryPolygon",
      outSR: "4326",
      f: "json",
    });
    const response = await fetch(`${ANM_MAPSERVER_URL}?${params.toString()}`, { signal: AbortSignal.timeout(20000) });
    if (response.ok) {
      const data = await response.json() as any;
      if (!data.error && data.features?.length) {
        const gj = await esriToGeoJSON(data.features);
        if (gj.features?.length) return gj.features[0].geometry;
      }
    }
  } catch {}
  try {
    const apiData = await mavrionApiFetch(
      `/api/anm/processos?search=${encodeURIComponent(cleanProcesso)}&include_geometry=true&limit=5`,
      20000,
    );
    if (apiData && Array.isArray(apiData.rows)) {
      const row = apiData.rows.find((r: any) => r.geometry && r.processo === cleanProcesso);
      if (row) return row.geometry;
    }
  } catch {}
  return null;
}

function matchesAnmFilters(attrs: any, f: {
  ufVal?: string | null; subsVal?: string | null; faseVal?: string | null; empVal?: string | null;
  procVal?: string | null; usoVal?: string | null; anoVal?: string | null; ultEventoVal?: string | null;
}): boolean {
  const unq = (s: string) => s.replace(/''/g, "'");
  if (f.ufVal && String(attrs.UF || "").toUpperCase() !== f.ufVal.toUpperCase()) return false;
  if (f.subsVal && !normalizeForCompare(String(attrs.SUBS || "")).includes(normalizeForCompare(unq(f.subsVal)))) return false;
  if (f.faseVal && !normalizeForCompare(String(attrs.FASE || "")).includes(normalizeForCompare(unq(f.faseVal)))) return false;
  if (f.empVal && !normalizeForCompare(String(attrs.NOME || "")).includes(normalizeForCompare(unq(f.empVal)))) return false;
  if (f.procVal && !String(attrs.PROCESSO || "").replace(/\./g, "").includes(unq(f.procVal).replace(/\./g, ""))) return false;
  if (f.usoVal && !normalizeForCompare(String(attrs.USO || "")).includes(normalizeForCompare(unq(f.usoVal)))) return false;
  if (f.anoVal && String(attrs.ANO) !== String(f.anoVal)) return false;
  if (f.ultEventoVal && !normalizeForCompare(String(attrs.ULT_EVENTO || "")).includes(normalizeForCompare(unq(f.ultEventoVal)))) return false;
  return true;
}

async function fetchAnmFromMavrionApi(filters: {
  uf?: string | null; substancia?: string | null; fase?: string | null;
  empresa?: string | null; processo?: string | null; uso?: string | null;
  ano?: string | null; ultEvento?: string | null;
}, includeGeometry = false): Promise<any[] | null> {
  const params = new URLSearchParams();
  if (filters.uf) params.set("uf", filters.uf.toUpperCase());
  if (filters.fase) params.set("fase", filters.fase);
  if (filters.substancia) params.set("subs", filters.substancia);
  if (filters.uso) params.set("uso", filters.uso);
  const search = filters.processo || filters.empresa;
  if (search) params.set("search", search.replace(/''/g, "'"));
  if (includeGeometry) params.set("include_geometry", "true");
  params.set("limit", "2000");
  const data = await mavrionApiFetch(`/api/anm/processos?${params.toString()}`, 30000);
  if (!data || !Array.isArray(data.rows)) return null;
  let rows = data.rows;
  // O `search` remoto casa processo OU nome — revalida os filtros localmente
  if (filters.processo) {
    const proc = filters.processo.replace(/''/g, "'").replace(/\./g, "");
    rows = rows.filter((r: any) => (r.processo || "").replace(/\./g, "").includes(proc));
  }
  if (filters.empresa) {
    const emp = normalizeForCompare(filters.empresa.replace(/''/g, "'"));
    rows = rows.filter((r: any) => normalizeForCompare(r.nome || "").includes(emp));
  }
  if (filters.ano) rows = rows.filter((r: any) => String(r.ano) === filters.ano);
  if (filters.ultEvento) {
    const ev = normalizeForCompare(filters.ultEvento.replace(/''/g, "'"));
    rows = rows.filter((r: any) => normalizeForCompare(r.ult_evento || "").includes(ev));
  }
  return rows.map((r: any) => {
    const attrs = mavrionRowToAnmAttrs(r);
    if (includeGeometry && r.geometry) attrs.__geometry = r.geometry;
    return attrs;
  });
}

async function esriToGeoJSON(esriFeatures: any[]) {
  // @ts-ignore
  const { arcgisToGeoJSON } = await import("@terraformer/arcgis");
  return {
    type: "FeatureCollection",
    features: esriFeatures.map((f: any) => ({
      type: "Feature",
      properties: f.attributes || {},
      geometry: f.geometry ? arcgisToGeoJSON(f.geometry) : null,
    })).filter((f: any) => f.geometry),
  };
}

function bboxFromGeometry(geojson: any): string {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      if (coords[0] < minLng) minLng = coords[0];
      if (coords[0] > maxLng) maxLng = coords[0];
      if (coords[1] < minLat) minLat = coords[1];
      if (coords[1] > maxLat) maxLat = coords[1];
      return;
    }
    for (const c of coords) traverse(c);
  }
  const geom = geojson.geometry || geojson;
  traverse(geom.coordinates);
  return `${minLng},${minLat},${maxLng},${maxLat}`;
}

function centroidFromGeometry(geojson: any): [number, number] {
  let sumLng = 0, sumLat = 0, count = 0;
  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      sumLng += coords[0]; sumLat += coords[1]; count++;
      return;
    }
    for (const c of coords) traverse(c);
  }
  const geom = geojson.geometry || geojson;
  traverse(geom.coordinates);
  return [sumLat / count, sumLng / count];
}

function samplePointsFromGeometry(geojson: any, max = 30): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  function traverse(coords: any) {
    if (typeof coords[0] === "number") {
      points.push([coords[1], coords[0]]);
      return;
    }
    for (const c of coords) traverse(c);
  }
  const geom = geojson.geometry || geojson;
  traverse(geom.coordinates);
  if (points.length <= max) return points;
  const step = Math.floor(points.length / max);
  return points.filter((_, i) => i % step === 0).slice(0, max);
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDeclivity(samplePoints: Array<[number, number]>, elevations: number[]): number | null {
  if (elevations.length < 2 || elevations.length !== samplePoints.length) return null;
  let totalSlope = 0;
  let count = 0;
  for (let i = 0; i < elevations.length - 1; i++) {
    const dist = haversineDistance(samplePoints[i][0], samplePoints[i][1], samplePoints[i + 1][0], samplePoints[i + 1][1]);
    if (dist > 10) {
      const dElev = Math.abs(elevations[i] - elevations[i + 1]);
      totalSlope += (dElev / dist) * 100;
      count++;
    }
  }
  return count > 0 ? Math.round((totalSlope / count) * 10) / 10 : null;
}

function nearestFeatureDistance(centLat: number, centLng: number, featureCollection: any): number | null {
  if (!featureCollection?.features?.length) return null;
  let minDist = Infinity;
  for (const feat of featureCollection.features) {
    if (!feat.geometry?.coordinates) continue;
    const coords: Array<[number, number]> = [];
    function extract(c: any) {
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        coords.push([c[1], c[0]]);
        return;
      }
      for (const sub of c) extract(sub);
    }
    extract(feat.geometry.coordinates);
    for (const [lat, lng] of coords) {
      const d = haversineDistance(centLat, centLng, lat, lng);
      if (d < minDist) minDist = d;
    }
  }
  return minDist === Infinity ? null : Math.round(minDist);
}

function computeGeoScore(data: {
  temRio: boolean; temLago: boolean; distAguaM: number | null;
  temEnergia: boolean; distEnergiaM: number | null;
  altMedia: number | null; declivMed: number | null;
  areaHa: number | null;
}): { score: number; breakdown: Record<string, number> } {
  let agua = 0;
  if (data.temRio || data.temLago) agua = data.temRio && data.temLago ? 30 : 25;
  else if (data.distAguaM !== null) {
    if (data.distAguaM < 500) agua = 15;
    else if (data.distAguaM < 2000) agua = 5;
  }

  let energia = 0;
  if (data.distEnergiaM !== null) {
    if (data.distEnergiaM < 1000) energia = 25;
    else if (data.distEnergiaM < 5000) energia = 15;
    else energia = 5;
  } else if (data.temEnergia) energia = 25;

  let altitude = 5;
  if (data.altMedia !== null) {
    if (data.altMedia >= 200 && data.altMedia <= 800) altitude = 20;
    else if (data.altMedia > 800 && data.altMedia <= 1200) altitude = 15;
  }

  let decliv = 0;
  if (data.declivMed != null && data.declivMed < 8) decliv = 10;
  else if (data.declivMed != null && data.declivMed < 15) decliv = 5;

  let area = 5;
  if (data.areaHa !== null) {
    if (data.areaHa > 1000) area = 15;
    else if (data.areaHa > 500) area = 12;
    else if (data.areaHa > 100) area = 8;
  }

  const score = Math.min(agua + energia + altitude + decliv + area, 100);
  return { score, breakdown: { agua, energia, altitude, decliv, area } };
}

function classifyEnergia(distM: number | null, hasEnergia: boolean): string {
  if (distM === null) return hasEnergia ? "ALTA" : "BAIXA";
  if (distM < 1000) return "ALTA";
  if (distM < 5000) return "MEDIA";
  return "BAIXA";
}

let _geoDb: NodePgDatabase<any> | null = null;

async function runGeoAnalysisInBackground(assetId: number, geometry: any, areaHa: number | null, orgId: number) {
  const db = _geoDb;
  if (!db) return;

  try {
    console.log(`[Geo Auto-Analysis] Iniciando análise para ativo ${assetId}...`);

    const bbox = bboxFromGeometry(geometry);
    const [centLat, centLng] = centroidFromGeometry(geometry);
    const samplePoints = samplePointsFromGeometry(geometry, 30);

    const bboxExpanded = (() => {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
      const pad = 0.1;
      return `${minLng - pad},${minLat - pad},${maxLng + pad},${maxLat + pad}`;
    })();

    const fetchIBGE = async (typeName: string) => {
      const params = new URLSearchParams({
        service: "WFS", version: "2.0.0", request: "GetFeature",
        typeName, outputFormat: "application/json",
        srsName: "EPSG:4326", count: "200",
        bbox: `${bboxExpanded},EPSG:4326`,
      });
      try {
        const r = await fetch(`${IBGE_WFS}?${params}`, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) return { type: "FeatureCollection", features: [] };
        return r.json();
      } catch { return { type: "FeatureCollection", features: [] }; }
    };

    const locations = samplePoints.map(p => `${p[0]},${p[1]}`).join("|");
    const elevPromise = (async () => {
      try {
        const r = await fetch(`${ELEVATION_API}?locations=${locations}`, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        return r.json();
      } catch { return null; }
    })();

    const [riosDataIBGE, massasDataIBGE, energiaDataIBGE, elevData] = await Promise.all([
      fetchIBGE("CCAR:BC100_Trecho_Drenagem_L"),
      fetchIBGE("CCAR:BC100_Massa_Dagua_A"),
      fetchIBGE("CCAR:BC100_Trecho_Energia_L"),
      elevPromise,
    ]);

    let riosData = riosDataIBGE;
    let massasData = massasDataIBGE;
    let energiaData = energiaDataIBGE;

    const ibgeWaterCount = (riosDataIBGE?.features?.length || 0) + (massasDataIBGE?.features?.length || 0);
    const ibgeEnergyCount = energiaDataIBGE?.features?.length || 0;

    if (ibgeWaterCount === 0 || ibgeEnergyCount === 0) {
      const [osmWater, osmPower] = await Promise.all([
        ibgeWaterCount === 0 ? fetchOSMWater(centLat, centLng, 0.15) : Promise.resolve(null),
        ibgeEnergyCount === 0 ? fetchOSMPower(centLat, centLng, 0.15) : Promise.resolve(null),
      ]);
      if (osmWater && osmWater.features?.length > 0) { riosData = osmWater; massasData = { type: "FeatureCollection", features: [] }; }
      if (osmPower && osmPower.features?.length > 0) { energiaData = osmPower; }
    }

    const temRio = (riosData?.features?.length || 0) > 0;
    const temLago = (massasDataIBGE?.features?.length || 0) > 0 || (riosData?.features || []).some((f: any) => f.properties?.natural === "water" || f.properties?.natural === "lake");
    const temEnergia = (energiaData?.features?.length || 0) > 0;

    const elevations = elevData?.results?.map((r: any) => r.elevation).filter((e: any) => typeof e === "number") || [];
    const altMedia = elevations.length > 0 ? Math.round(elevations.reduce((a: number, b: number) => a + b, 0) / elevations.length) : null;
    const altMin = elevations.length > 0 ? Math.min(...elevations) : null;
    const altMax = elevations.length > 0 ? Math.max(...elevations) : null;

    const declivMed = estimateDeclivity(samplePoints, elevations);

    const allWater = { type: "FeatureCollection", features: [...(riosData?.features || []), ...(massasData?.features || [])] };
    const distAguaM = nearestFeatureDistance(centLat, centLng, allWater);
    const distEnergiaM = nearestFeatureDistance(centLat, centLng, energiaData);

    const scoreEn = classifyEnergia(distEnergiaM, temEnergia);
    const { score: geoScoreVal } = computeGeoScore({
      temRio, temLago, distAguaM, temEnergia, distEnergiaM,
      altMedia, declivMed, areaHa,
    });

    await db.execute(sql`
      UPDATE assets SET
        geo_alt_med = ${altMedia},
        geo_alt_min = ${altMin},
        geo_alt_max = ${altMax},
        geo_decliv_med = ${declivMed},
        geo_tem_rio = ${temRio},
        geo_tem_lago = ${temLago},
        geo_dist_agua_m = ${distAguaM},
        geo_tem_energia = ${temEnergia},
        geo_dist_energia_m = ${distEnergiaM},
        geo_score_energia = ${scoreEn},
        geo_score = ${geoScoreVal},
        geo_analyzed_at = NOW(),
        attributes_json = COALESCE(attributes_json, '{}'::jsonb) || ${JSON.stringify({
          geoTemRio: temRio, geoTemLago: temLago, geoTemEnergia: temEnergia,
          geoAltMedia: altMedia, geoAltMin: altMin, geoAltMax: altMax,
          geoDeclivMed: declivMed, geoDistAguaM: distAguaM,
          geoDistEnergiaM: distEnergiaM, geoScoreEnergia: scoreEn, geoScore: geoScoreVal,
          autoAnalyzed: true,
        })}::jsonb
      WHERE id = ${assetId} AND org_id = ${orgId}
    `);

    console.log(`[Geo Auto-Analysis] Ativo ${assetId}: geoScore=${geoScoreVal}, altMedia=${altMedia}, temRio=${temRio}, temEnergia=${temEnergia}`);
  } catch (err: any) {
    console.error(`[Geo Auto-Analysis] Erro no ativo ${assetId}:`, err.message);
  }
}

export function registerGeoRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
  _geoDb = db;

  let municipiosCache: Record<string, { nome: string; codigoIbge: string | null }[]> = {};
  app.get("/api/municipios", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const uf = String(req.query.uf || "").toUpperCase();
    if (!uf || uf.length !== 2) return res.json([]);
    if (municipiosCache[uf]) return res.json(municipiosCache[uf]);
    try {
      let result: { nome: string; codigoIbge: string | null }[] = [];
      try {
        const rows = await db.execute(sql`SELECT nome, codigo_ibge FROM municipios_br WHERE uf = ${uf} ORDER BY nome`);
        result = (rows.rows as any[]).map((r: any) => ({ nome: r.nome, codigoIbge: r.codigo_ibge }));
      } catch {}
      if (result.length === 0) {
        // tabela ausente/vazia — busca direto na API do IBGE
        const resp = await fetch(
          `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
          { signal: AbortSignal.timeout(15000) },
        );
        if (resp.ok) {
          const data = await resp.json() as any[];
          result = data
            .map((m: any) => ({ nome: m.nome, codigoIbge: m.id ? String(m.id) : null }))
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        }
      }
      if (result.length > 0) municipiosCache[uf] = result;
      return res.json(result);
    } catch (err) {
      console.error("[Municipios] Error:", err);
      return res.json([]);
    }
  });

  let _subsCache: string[] | null = null;
  app.get("/api/anm/substancias", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    if (_subsCache) return res.json(_subsCache);
    try {
      const result = await db.execute(sql`SELECT nome FROM anm_substancias ORDER BY nome`);
      const rows = (result as any).rows || result;
      _subsCache = rows.map((r: any) => r.nome);
      return res.json(_subsCache);
    } catch (err) {
      console.error("[ANM Substancias] Error:", err);
      return res.json([]);
    }
  });

  app.get("/api/anm/processos", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const clauses: string[] = [];

      const ufVal = sanitizeAnmInput(req.query.uf, ANM_PATTERNS.uf);
      if (ufVal) clauses.push(`UF='${ufVal.toUpperCase()}'`);

      const subsVal = sanitizeAnmInput(req.query.substancia, ANM_PATTERNS.substancia);
      if (subsVal) clauses.push(buildAccentAwareLike("SUBS", subsVal));

      const faseVal = sanitizeAnmInput(req.query.fase, ANM_PATTERNS.fase);
      if (faseVal) clauses.push(buildAccentAwareLike("FASE", faseVal, false));

      const empVal = sanitizeAnmInput(req.query.empresa, ANM_PATTERNS.empresa);
      if (empVal) clauses.push(buildAccentAwareLike("NOME", empVal));

      // Base SIGMINE guarda o processo sem pontos (ex.: 861060/2023) — normaliza "861.060/2023"
      const procRaw = sanitizeAnmInput(req.query.processo, ANM_PATTERNS.processo);
      const procVal = procRaw ? procRaw.replace(/\./g, "") : procRaw;
      if (procVal) clauses.push(`PROCESSO LIKE '%${procVal}%'`);

      const usoVal = sanitizeAnmInput(req.query.uso, ANM_PATTERNS.uso);
      if (usoVal) {
        const usoUpper = usoVal.toUpperCase();
        const pattern = fullyInsensitiveLike(usoUpper);
        clauses.push(`UPPER(USO) LIKE '%${pattern}%'`);
      }

      const anoVal = sanitizeAnmInput(req.query.ano, ANM_PATTERNS.ano);
      if (anoVal) clauses.push(`ANO=${anoVal}`);

      const ultEventoVal = sanitizeAnmInput(req.query.ultEvento, ANM_PATTERNS.ultEvento);
      if (ultEventoVal) clauses.push(buildAccentAwareLike("ULT_EVENTO", ultEventoVal));

      const municipioVal = /^\d{7}$/.test(String(req.query.municipio || "")) ? String(req.query.municipio) : null;

      // raio (km) opcional em torno do município — 1 a 500 km
      const raioRaw = parseInt(String(req.query.raioKm || ""), 10);
      const raioKm = municipioVal && Number.isFinite(raioRaw) && raioRaw >= 1 && raioRaw <= 500 ? raioRaw : null;

      if (clauses.length === 0 && !municipioVal) {
        return res.status(400).json({ message: "Informe ao menos um filtro de busca válido." });
      }

      const cacheKey = JSON.stringify({ uf: ufVal, substancia: subsVal, fase: faseVal, empresa: empVal, processo: procVal, uso: usoVal, ano: anoVal, ultEvento: ultEventoVal, municipio: municipioVal, raioKm });
      const cached = await getCached<any>("anm", cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const whereClause = clauses.join(" AND ");
      const params = new URLSearchParams({
        where: whereClause,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
        returnGeometry: "false",
        outSR: "4326",
        f: "json",
      });

      let features: any[] | null = null;

      if (municipioVal) {
        // Filtro por município: a base ANM não tem cidade — cruza os polígonos
        // dos processos com o limite municipal (malha IBGE)
        const muniGeom = await fetchMunicipioPolygon(municipioVal);
        if (!muniGeom) {
          return res.status(502).json({ message: "Não foi possível obter o limite do município (IBGE)" });
        }
        const muniCenter = geomCentroidPt(muniGeom);
        const bbox = raioKm && muniCenter
          ? (expandedBboxFromGeom(muniGeom, raioKm) || bboxFromGeometry({ geometry: muniGeom }))
          : bboxFromGeometry({ geometry: muniGeom });
        const localFilters = { ufVal, subsVal, faseVal, empVal, procVal, usoVal, anoVal, ultEventoVal };

        // aceita o processo se: dentro do município OU (com raio) a até raioKm do centro
        const passaMunicipioOuRaio = (geometry: any): { ok: boolean; distKm: number | null } => {
          const pt = geomCentroidPt(geometry);
          if (!pt) return { ok: false, distKm: null };
          const distKm = muniCenter ? haversineKm(muniCenter, pt) : null;
          if (raioKm && distKm != null) return { ok: distKm <= raioKm, distKm };
          return { ok: pointInGeom(pt, muniGeom), distKm };
        };

        // consulta espacial no geoportal (bbox não usa aspas — passa no WAF)
        try {
          const spatialParams = new URLSearchParams({
            where: "1>0",
            geometry: bbox,
            geometryType: "esriGeometryEnvelope",
            inSR: "4326",
            spatialRel: "esriSpatialRelIntersects",
            outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF,ULT_EVENTO,DSProcesso,ANO,USO,ID",
            returnGeometry: "true",
            outSR: "4326",
            f: "json",
          });
          const response = await fetch(ANM_MAPSERVER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: spatialParams.toString(),
            signal: AbortSignal.timeout(30000),
          });
          if (response.ok) {
            const data = await response.json() as any;
            if (!data.error) {
              features = (data.features || [])
                .map((f: any) => {
                  const check = passaMunicipioOuRaio(f.geometry);
                  if (!check.ok) return null;
                  const attrs = f.attributes || f;
                  return { ...attrs, DIST_KM: check.distKm != null ? Math.round(check.distKm * 10) / 10 : null };
                })
                .filter(Boolean)
                .filter((attrs: any) => matchesAnmFilters(attrs, localFilters));
            }
          }
        } catch {}

        if (!features) {
          // fallback: base espelhada com geometria + teste ponto-no-polígono
          console.warn("[ANM] Geoportal falhou (município) — usando fallback via API Mavrion");
          const rows = await fetchAnmFromMavrionApi({
            uf: ufVal, substancia: subsVal, fase: faseVal, empresa: empVal,
            processo: procVal, uso: usoVal, ano: anoVal, ultEvento: ultEventoVal,
          }, true);
          if (rows) {
            features = rows
              .map((row: any) => {
                const check = passaMunicipioOuRaio(row.__geometry);
                if (!check.ok) return null;
                const { __geometry, ...attrs } = row;
                return { ...attrs, DIST_KM: check.distKm != null ? Math.round(check.distKm * 10) / 10 : null };
              })
              .filter(Boolean);
          }
        }
      } else {
        try {
          const response = await fetch(`${ANM_MAPSERVER_URL}?${params.toString()}`, { signal: AbortSignal.timeout(30000) });
          if (response.ok) {
            const data = await response.json() as any;
            if (!data.error) {
              features = (data.features || []).map((f: any) => f.attributes || f);
            }
          }
        } catch {}

        if (!features) {
          // Geoportal indisponível/bloqueado (WAF) — usa a base SIGMINE espelhada
          console.warn("[ANM] Geoportal falhou — usando fallback via API Mavrion");
          features = await fetchAnmFromMavrionApi({
            uf: ufVal, substancia: subsVal, fase: faseVal, empresa: empVal,
            processo: procVal, uso: usoVal, ano: anoVal, ultEvento: ultEventoVal,
          });
        }
      }

      if (!features) {
        return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
      }
      const result = { features, total: features.length };
      await setCached("anm", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("ANM processos error:", err.message);
      res.status(500).json({ message: "Erro ao consultar processos ANM" });
    }
  });

  app.get("/api/anm/geometria/:processo", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const cleanProcesso = (req.params.processo || "").replace(/[^0-9/]/g, "");
      if (!cleanProcesso || cleanProcesso.length < 3) {
        return res.status(400).json({ message: "Número de processo inválido" });
      }

      const params = new URLSearchParams({
        where: `PROCESSO='${cleanProcesso}'`,
        outFields: "PROCESSO,NOME,FASE,SUBS,AREA_HA,UF",
        returnGeometry: "true",
        geometryType: "esriGeometryPolygon",
        outSR: "4326",
        f: "json",
      });

      let geojson: any | null = null;
      try {
        const response = await fetch(`${ANM_MAPSERVER_URL}?${params.toString()}`, { signal: AbortSignal.timeout(30000) });
        if (response.ok) {
          const data = await response.json() as any;
          if (!data.error) {
            geojson = await esriToGeoJSON(data.features || []);
          }
        }
      } catch {}

      if (!geojson || !geojson.features?.length) {
        // Fallback: base SIGMINE espelhada na API Mavrion (geometria em GeoJSON)
        const apiData = await mavrionApiFetch(
          `/api/anm/processos?search=${encodeURIComponent(cleanProcesso)}&include_geometry=true&limit=5`,
          30000,
        );
        if (apiData && Array.isArray(apiData.rows)) {
          geojson = {
            type: "FeatureCollection",
            features: apiData.rows
              .filter((r: any) => r.geometry && r.processo === cleanProcesso)
              .map((r: any) => ({ type: "Feature", properties: mavrionRowToAnmAttrs(r), geometry: r.geometry })),
          };
        }
      }

      if (!geojson) {
        return res.status(502).json({ message: "Falha ao consultar geometria no geoportal ANM" });
      }
      res.json(geojson);
    } catch (err: any) {
      console.error("ANM geometria error:", err.message);
      res.status(500).json({ message: "Erro ao consultar geometria ANM" });
    }
  });

  // Resolve o município de cada processo (centroide × malha municipal IBGE), com cache por processo
  app.post("/api/anm/municipios", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const raw = Array.isArray(req.body?.processos) ? req.body.processos : [];
      const items = raw
        .map((it: any) => ({
          original: String(it?.processo || ""),
          processo: String(it?.processo || "").replace(/[^0-9/]/g, ""),
          uf: String(it?.uf || "").toUpperCase().slice(0, 2),
        }))
        .filter((it: any) => it.processo.length >= 3 && /^[A-Z]{2}$/.test(it.uf))
        .slice(0, 25);

      const result: Record<string, string | null> = {};

      const resolveOne = async (item: { original: string; processo: string; uf: string }) => {
        const cacheKey = `anm_muni:${item.processo}`;
        const cached = await getCached<{ municipio: string | null }>("geo", cacheKey);
        if (cached) {
          result[item.original] = cached.municipio;
          return;
        }
        let municipio: string | null = null;
        const geom = await fetchProcessoGeometry(item.processo);
        if (geom) {
          const pt = geomCentroidPt(geom);
          if (pt) {
            const resolved = await resolveMunicipioFromPoint(pt, item.uf);
            municipio = resolved?.nome || null;
          }
        }
        result[item.original] = municipio;
        // só cacheia resoluções bem-sucedidas — falhas podem ser transitórias
        if (municipio) await setCached("geo", cacheKey, { municipio });
      };

      // concorrência limitada para não sobrecarregar o geoportal
      const queue = [...items];
      const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) break;
          try { await resolveOne(item); } catch { result[item.original] = null; }
        }
      });
      await Promise.all(workers);

      res.json(result);
    } catch (err: any) {
      console.error("ANM municipios error:", err.message);
      res.status(500).json({ message: "Erro ao resolver municípios" });
    }
  });

  app.get("/api/anm/imported", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const allAssets = await storage.getAssets();
      const imported: Record<string, number> = {};
      for (const a of allAssets as any[]) {
        if (a.anmProcesso) imported[a.anmProcesso] = a.id;
      }
      res.json(imported);
    } catch (err: any) {
      res.status(500).json({ message: "Erro ao verificar processos importados" });
    }
  });

  app.post("/api/anm/import-asset", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { processo, nome, fase, substancia, areaHa: bodyArea, uf, ultEvento, uso, ano } = req.body;
      if (!processo) {
        return res.status(400).json({ message: "Número do processo é obrigatório" });
      }

      const existingAssets = await storage.getAssets();
      const alreadyImported = existingAssets.find((a: any) => a.anmProcesso === processo);
      if (alreadyImported) {
        return res.status(409).json({ message: "Este processo ANM já foi importado como ativo.", assetId: alreadyImported.id });
      }

      let linkedCompanyId: number | null = null;
      if (nome) {
        const allCompanies = await storage.getCompanies();
        const match = allCompanies.find((c: any) => {
          const names = [c.legalName, c.tradeName].filter(Boolean).map((n: string) => n.toUpperCase());
          const searchName = nome.toUpperCase();
          return names.some((n: string) => n.includes(searchName) || searchName.includes(n));
        });
        if (match) linkedCompanyId = match.id;
      }

      let latitude: number | null = null;
      let longitude: number | null = null;
      let codigoIbge: string | null = null;
      let municipio: string | null = null;
      let importedGeometry: any = null;

      try {
        const formBody = new URLSearchParams({
          where: `PROCESSO='${processo.replace(/[^0-9/]/g, "")}'`,
          outFields: "PROCESSO,UF,SUBS,AREA_HA",
          returnGeometry: "true",
          geometryType: "esriGeometryPolygon",
          outSR: "4326",
          f: "json",
        });
        const geoResp = await fetch(ANM_MAPSERVER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody.toString(),
          signal: AbortSignal.timeout(15000),
        });
        if (geoResp.ok) {
          const geoData = await geoResp.json() as any;
          const features = geoData.features || [];
          if (features.length > 0 && features[0].geometry?.rings) {
            const rings = features[0].geometry.rings;
            const coordinates = rings.map((ring: number[][]) => ring.map((c: number[]) => [c[0], c[1]]));
            importedGeometry = { type: "Polygon", coordinates };

            const [cLat, cLng] = centroidFromGeometry(importedGeometry);
            if (cLat && cLng && !isNaN(cLat) && !isNaN(cLng)) {
              latitude = Math.round(cLat * 1e6) / 1e6;
              longitude = Math.round(cLng * 1e6) / 1e6;
            }
          } else {
            const geojson = await esriToGeoJSON(features);
            if (geojson.features?.length > 0) {
              importedGeometry = geojson.features[0].geometry;
              const [lat, lng] = centroidFromGeometry(importedGeometry);
              if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
                latitude = Math.round(lat * 1e6) / 1e6;
                longitude = Math.round(lng * 1e6) / 1e6;
              }
            }
          }
        }
      } catch (geoErr: any) {
        console.error("ANM geo lookup (non-fatal):", geoErr.message);
      }

      // Fallback: geoportal indisponível/bloqueado → espelho Mavrion
      if (!importedGeometry) {
        try {
          const fallbackGeom = await fetchProcessoGeometry(String(processo).replace(/[^0-9/]/g, ""));
          if (fallbackGeom) {
            importedGeometry = fallbackGeom;
            const [fLat, fLng] = centroidFromGeometry(fallbackGeom);
            if (fLat && fLng && !isNaN(fLat) && !isNaN(fLng)) {
              latitude = Math.round(fLat * 1e6) / 1e6;
              longitude = Math.round(fLng * 1e6) / 1e6;
            }
          }
        } catch {}
      }

      // Resolve município/código IBGE pelo centroide (reutilizando o cache anm_muni)
      if (latitude != null && longitude != null && uf && /^[A-Z]{2}$/i.test(String(uf))) {
        const cleanProcesso = String(processo).replace(/[^0-9/]/g, "");
        const cacheKey = `anm_muni:${cleanProcesso}`;
        try {
          const cached = await getCached<{ municipio: string | null; codigoIbge?: string | null }>("geo", cacheKey);
          if (cached?.municipio && cached.codigoIbge) {
            municipio = cached.municipio;
            codigoIbge = cached.codigoIbge;
          } else {
            const resolved = await resolveMunicipioFromPoint([longitude, latitude], String(uf).toUpperCase());
            if (resolved) {
              municipio = resolved.nome;
              codigoIbge = resolved.codigoIbge;
              await setCached("geo", cacheKey, { municipio, codigoIbge });
            } else if (cached?.municipio) {
              municipio = cached.municipio;
            }
          }
        } catch (muniErr: any) {
          console.error("ANM municipio resolve (non-fatal):", muniErr.message);
        }
      }

      const orgId = getOrgId(req);
      const asset = await storage.createAsset({
        orgId,
        type: "MINA",
        title: `${substancia || "Processo"} - ${processo}`,
        description: `Processo minerário ANM: ${processo}\nTitular: ${nome || "N/A"}\nFase: ${fase || "N/A"}\nSubstância: ${substancia || "N/A"}\nUso: ${uso || "N/A"}\nÚltimo Evento: ${ultEvento || "N/A"}`,
        location: municipio ? `${municipio}/${uf || ""}` : (uf || null),
        estado: uf || null,
        municipio: municipio || null,
        areaHa: bodyArea ? Number(bodyArea) : null,
        tags: ["ANM", "Importado"],
        anmProcesso: processo,
        linkedCompanyId,
        camposEspecificos: {
          latitude,
          longitude,
          codigoIbge,
          municipio,
        } as any,
        attributesJson: {
          anmNome: nome || null,
          anmFase: fase || null,
          anmSubstancia: substancia || null,
          anmUso: uso || null,
          anmAno: ano || null,
          anmUltEvento: ultEvento || null,
          importadoEm: new Date().toISOString(),
        },
      });

      if (importedGeometry && latitude && longitude) {
        runGeoAnalysisInBackground(asset.id, importedGeometry, bodyArea ? Number(bodyArea) : null, orgId);
      }

      res.status(201).json(asset);
    } catch (err: any) {
      console.error("ANM import asset error:", err.message);
      res.status(500).json({ message: "Erro ao importar processo como ativo" });
    }
  });

  // Backfill administrativo: preenche município/código IBGE de ativos ANM
  // importados antes da resolução automática de município (centroide + malha IBGE)
  app.post("/api/anm/backfill-municipios", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    const user = req.user as any;
    if (user?.role !== "admin" && user?.role !== "superadmin") {
      return res.status(403).json({ message: "Apenas administradores podem executar o backfill" });
    }
    try {
      // Escopo multi-tenant: só ativos da organização do usuário autenticado
      const orgId = getOrgId(req);
      const allAssets = await storage.getAssets(orgId);
      const pending = (allAssets as any[]).filter(
        (a) => a.orgId === orgId && a.anmProcesso && (!a.municipio || String(a.municipio).trim() === ""),
      );

      const results: Array<{ id: number; processo: string; municipio: string | null; codigoIbge: string | null; status: string }> = [];

      // Saneamento: ativos que já têm município mas cujo location está vazio ou contém só a UF
      const locationIncomplete = (allAssets as any[]).filter((a) => {
        if (a.orgId !== orgId || !a.anmProcesso) return false;
        const muni = a.municipio ? String(a.municipio).trim() : "";
        if (!muni) return false;
        const loc = a.location ? String(a.location).trim() : "";
        return loc === "" || /^[A-Za-z]{2}$/.test(loc);
      });
      for (const asset of locationIncomplete) {
        const uf = asset.estado && /^[A-Z]{2}$/i.test(String(asset.estado)) ? String(asset.estado).toUpperCase() : null;
        if (!uf) continue;
        const municipio = String(asset.municipio).trim();
        try {
          await storage.updateAsset(asset.id, { location: `${municipio}/${uf}` } as any);
          results.push({ id: asset.id, processo: String(asset.anmProcesso), municipio, codigoIbge: null, status: "location_corrigido" });
        } catch (err: any) {
          console.error(`[ANM backfill] Falha ao corrigir location do ativo ${asset.id}:`, err.message);
          results.push({ id: asset.id, processo: String(asset.anmProcesso), municipio, codigoIbge: null, status: "erro" });
        }
      }

      for (const asset of pending) {
        const processo = String(asset.anmProcesso);
        const cleanProcesso = processo.replace(/[^0-9/]/g, "");
        const uf = asset.estado && /^[A-Z]{2}$/i.test(String(asset.estado)) ? String(asset.estado).toUpperCase() : null;
        if (!uf) {
          results.push({ id: asset.id, processo, municipio: null, codigoIbge: null, status: "sem_uf" });
          continue;
        }

        try {
          const ce = (asset.camposEspecificos || {}) as any;
          let latitude: number | null = typeof ce.latitude === "number" ? ce.latitude : null;
          let longitude: number | null = typeof ce.longitude === "number" ? ce.longitude : null;

          if (latitude == null || longitude == null) {
            const geom = await fetchProcessoGeometry(cleanProcesso);
            const pt = geom ? geomCentroidPt(geom) : null;
            if (pt) {
              longitude = Math.round(pt[0] * 1e6) / 1e6;
              latitude = Math.round(pt[1] * 1e6) / 1e6;
            }
          }

          if (latitude == null || longitude == null) {
            results.push({ id: asset.id, processo, municipio: null, codigoIbge: null, status: "sem_geometria" });
            continue;
          }

          const cacheKey = `anm_muni:${cleanProcesso}`;
          let municipio: string | null = null;
          let codigoIbge: string | null = null;
          const cached = await getCached<{ municipio: string | null; codigoIbge?: string | null }>("geo", cacheKey);
          if (cached?.municipio && cached.codigoIbge) {
            municipio = cached.municipio;
            codigoIbge = cached.codigoIbge;
          } else {
            const resolved = await resolveMunicipioFromPoint([longitude, latitude], uf);
            if (resolved) {
              municipio = resolved.nome;
              codigoIbge = resolved.codigoIbge;
              await setCached("geo", cacheKey, { municipio, codigoIbge });
            } else if (cached?.municipio) {
              municipio = cached.municipio;
            }
          }

          if (!municipio) {
            results.push({ id: asset.id, processo, municipio: null, codigoIbge: null, status: "nao_resolvido" });
            continue;
          }

          // Merge atômico: envia só o delta, sem regravar o objeto inteiro (o
          // spread de `ce` apagaria chaves de enriquecimento salvas em paralelo).
          await storage.mergeAssetCampos(asset.id, {
            latitude,
            longitude,
            ...(codigoIbge ? { codigoIbge } : {}),
            municipio,
          }, {
            municipio,
            location: `${municipio}/${uf}`,
          });

          results.push({ id: asset.id, processo, municipio, codigoIbge, status: "atualizado" });
        } catch (err: any) {
          console.error(`[ANM backfill] Falha no ativo ${asset.id} (${processo}):`, err.message);
          results.push({ id: asset.id, processo, municipio: null, codigoIbge: null, status: "erro" });
        }
      }

      const atualizados = results.filter((r) => r.status === "atualizado").length;
      res.json({ total: pending.length, atualizados, resultados: results });
    } catch (err: any) {
      console.error("ANM backfill municipios error:", err.message);
      res.status(500).json({ message: "Erro ao executar backfill de municípios" });
    }
  });

  app.get("/api/geo/sicar-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const [apiHealth, apiStats] = await Promise.allSettled([
        mavrionApiFetch("/api/health", 8000),
        mavrionApiFetch("/api/sicar/cache-stats", 8000),
      ]);

      const apiOnline = apiHealth.status === "fulfilled" && apiHealth.value !== null;
      const cacheStats = apiStats.status === "fulfilled" ? apiStats.value : null;

      res.json({
        online: apiOnline,
        apiOnline,
        cacheStats,
        checkedAt: new Date().toISOString(),
        portalUrl: CAR_PUBLIC_URL,
      });
    } catch {
      res.json({
        online: false,
        apiOnline: false,
        cacheStats: null,
        checkedAt: new Date().toISOString(),
        portalUrl: CAR_PUBLIC_URL,
      });
    }
  });

  app.get("/api/geo/fazendas/car/:codigo", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const codigo = String(req.params.codigo).trim();
      if (!codigo || codigo.length < 5 || codigo.length > 100) {
        return res.status(400).json({ message: "Código CAR inválido" });
      }
      if (!/^[A-Za-z0-9\-_]+$/.test(codigo)) {
        return res.status(400).json({ message: "Código CAR contém caracteres inválidos" });
      }

      const ufFromCode = codigo.substring(0, 2).toUpperCase();
      if (!UF_LIST.includes(ufFromCode)) {
        return res.status(400).json({ message: `UF '${ufFromCode}' extraída do código não é válida` });
      }

      const apiResult = await mavrionApiFetch(`/api/sicar/${encodeURIComponent(codigo)}`, 15000);
      if (apiResult && apiResult.cod_imovel) {
        const feature = apiRecordToFeature(apiResult);
        const result = {
          type: "FeatureCollection",
          features: [feature],
          totalFeatures: 1,
          source: "mavrion-api",
        };
        res.setHeader("X-Data-Source", "mavrion-api");
        return res.json(result);
      }

      return res.status(404).json({
        message: "Imóvel não encontrado",
        suggestion: "O código CAR informado não foi encontrado na API SICARIOn.",
      });
    } catch (err: any) {
      console.error("[CAR Busca] Erro:", err);
      logApiError({ service: "SICAR", endpoint: "car-busca", errorMessage: err?.message || "CAR search failed" });
      res.status(500).json({ message: "Erro ao buscar imóvel por código CAR" });
    }
  });

  app.get("/api/geo/fazendas", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { uf, municipio, areaMin, areaMax, status, tipo, condicao, altMediaMin, altMediaMax, argilaMediaMin, argilaMediaMax } = req.query;
      if (!uf || !UF_LIST.includes(String(uf).toUpperCase())) {
        return res.status(400).json({ message: "UF obrigatório e válido" });
      }
      const ufUpper = String(uf).toUpperCase();
      const count = Math.min(Number(req.query.count) || 30, 50);
      const startIndex = Number(req.query.startIndex) || 0;

      const apiParams = new URLSearchParams({ uf: ufUpper, limit: String(count), offset: String(startIndex) });
      if (municipio) apiParams.set("municipio", String(municipio));
      if (areaMin) apiParams.set("area_min", String(areaMin));
      if (areaMax) apiParams.set("area_max", String(areaMax));
      if (status) apiParams.set("ind_status", String(status));
      if (tipo) apiParams.set("ind_tipo", String(tipo));
      if (condicao) apiParams.set("condicao", String(condicao));
      if (altMediaMin) apiParams.set("alt_media_min", String(altMediaMin));
      if (altMediaMax) apiParams.set("alt_media_max", String(altMediaMax));
      if (argilaMediaMin) apiParams.set("argila_media_min", String(argilaMediaMin));
      if (argilaMediaMax) apiParams.set("argila_media_max", String(argilaMediaMax));

      const apiData = await mavrionApiFetch(`/api/sicar/search?${apiParams.toString()}`, 30000);
      if (apiData && Array.isArray(apiData.data)) {
        const featureCollection = {
          type: "FeatureCollection",
          features: apiData.data.map((r: any) => apiRecordToFeature(r)),
          totalFeatures: apiData.total || apiData.data.length,
          numberMatched: apiData.total || apiData.data.length,
          source: "mavrion-api",
        };
        res.setHeader("X-Data-Source", "mavrion-api");
        return res.json(featureCollection);
      }

      res.status(502).json({
        message: "Dados indisponíveis",
        detail: "A API SICARIOn está indisponível no momento. Tente novamente em instantes.",
        portalUrl: CAR_PUBLIC_URL,
      });
    } catch (err: any) {
      console.error("Geo fazendas error:", err.message);
      res.status(502).json({
        message: "Dados indisponíveis",
        detail: "Erro ao buscar imóveis rurais. Tente novamente em instantes.",
        portalUrl: CAR_PUBLIC_URL,
      });
    }
  });

  app.get("/api/geo/fazendas/geojson", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { uf, municipio, areaMin, areaMax, status, tipo, condicao, altMediaMin, altMediaMax, argilaMediaMin, argilaMediaMax } = req.query;
      if (!uf || !UF_LIST.includes(String(uf).toUpperCase())) {
        return res.status(400).json({ message: "UF obrigatório e válido" });
      }
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 500);
      const offset = Number(req.query.offset) || 0;
      const apiParams = new URLSearchParams({
        uf: String(uf).toUpperCase(),
        limit: String(limit),
        offset: String(offset),
        include_geometry: "true",
        sort: "num_area",
        order: "desc",
      });
      if (municipio) apiParams.set("municipio", String(municipio));
      if (areaMin) apiParams.set("area_min", String(areaMin));
      if (areaMax) apiParams.set("area_max", String(areaMax));
      if (status) apiParams.set("ind_status", String(status));
      if (tipo) apiParams.set("ind_tipo", String(tipo));
      if (condicao) apiParams.set("condicao", String(condicao));
      if (altMediaMin) apiParams.set("alt_media_min", String(altMediaMin));
      if (altMediaMax) apiParams.set("alt_media_max", String(altMediaMax));
      if (argilaMediaMin) apiParams.set("argila_media_min", String(argilaMediaMin));
      if (argilaMediaMax) apiParams.set("argila_media_max", String(argilaMediaMax));

      const apiData = await mavrionApiFetch(`/api/sicar/imoveis?${apiParams.toString()}`, 30000);
      if (!apiData || !Array.isArray(apiData.data)) {
        return res.status(502).json({ message: "API SICARIOn indisponível" });
      }

      const features = apiData.data.map((r: any) => {
        const geom = r.geojson || r.geometry || null;
        return {
          type: "Feature",
          id: r.cod_imovel || r.id,
          geometry: geom,
          properties: {
            cod_imovel: r.cod_imovel,
            municipio: r.municipio,
            uf: r.uf,
            num_area: r.num_area,
            ind_status: r.ind_status,
            ind_tipo: r.ind_tipo,
            condicao: r.condicao,
            m_fiscal: r.m_fiscal,
            dat_criacao: r.dat_criacao,
            alt_media: r.alt_media ?? null,
            argila_media: r.argila_media ?? null,
          },
        };
      }).filter((f: any) => f.geometry != null);

      res.json({
        type: "FeatureCollection",
        features,
        total: apiData.total || 0,
        limit,
        offset,
      });
    } catch (err: any) {
      console.error("Geo fazendas geojson error:", err.message);
      res.status(502).json({ message: "Erro ao buscar geometrias" });
    }
  });

  app.post("/api/geo/fazendas/import", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { cod_imovel, uf, municipio, num_area, ind_status, ind_tipo, condicao, dat_criacao, m_fiscal, geojson, cod_municipio_ibge } = req.body;
      console.log("[GEO IMPORT] body keys:", Object.keys(req.body), "cod_municipio_ibge:", cod_municipio_ibge);
      if (!cod_imovel || typeof cod_imovel !== "string") return res.status(400).json({ message: "cod_imovel obrigatório" });
      if (uf && !UF_LIST.includes(String(uf).toUpperCase())) return res.status(400).json({ message: "UF inválido" });

      const user = req.user as any;
      const orgId = getOrgId(req);

      const existingConditions = [eq(assets.carCodImovel, String(cod_imovel))];
      if (orgId) existingConditions.push(eq(assets.orgId, orgId));
      const existing = await db.select({ id: assets.id }).from(assets).where(and(...existingConditions)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ message: "Propriedade já importada" });
      }

      const rawArea = num_area != null ? Number(num_area) : null;
      const areaNum = rawArea !== null && Number.isFinite(rawArea) ? rawArea : null;
      const title = `Propriedade SICAR - ${municipio || ""}/${uf || ""}`.trim();
      const location = municipio && uf ? `${municipio} - ${uf}` : (municipio || uf || "");

      const novoAtivo = await storage.createAsset({
        orgId,
        type: "TERRA",
        title,
        description: `Imóvel rural importado do SICAR. Código CAR: ${cod_imovel}`,
        location,
        municipio: municipio || null,
        estado: uf || null,
        areaHa: areaNum,
        carCodImovel: String(cod_imovel),
        statusAtivo: "ativo",
        attributesJson: {
          carCodImovel: String(cod_imovel),
          carMunicipio: municipio || null,
          carUf: uf || null,
          carStatus: ind_status || null,
          carTipo: ind_tipo || null,
          carArea: areaNum,
          ind_status: ind_status || null,
          ind_tipo: ind_tipo || null,
          condicao: condicao || null,
          m_fiscal: m_fiscal != null && Number.isFinite(Number(m_fiscal)) ? Number(m_fiscal) : null,
          dat_criacao: dat_criacao || null,
          fonte: "SICAR",
          importadoEm: new Date().toISOString(),
        },
      });

      let ibgeCode = cod_municipio_ibge ? String(cod_municipio_ibge) : null;
      if (!ibgeCode) {
        try {
          const sicarDetail = await mavrionApiFetch(`/api/sicar/${encodeURIComponent(String(cod_imovel))}`, 10000);
          if (sicarDetail?.cod_municipio_ibge) {
            ibgeCode = String(sicarDetail.cod_municipio_ibge);
            console.log(`[GEO IMPORT] IBGE code fetched from API: ${ibgeCode}`);
          }
        } catch (e) {
          console.warn("[GEO IMPORT] Failed to fetch IBGE code from API:", (e as any)?.message);
        }
      }

      const camposPatch: any = { carCodigo: String(cod_imovel), municipio: municipio || null, uf: uf || null };
      if (ibgeCode) camposPatch.codigoIbge = ibgeCode;

      await db.execute(sql`
        UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify(camposPatch)}::jsonb
        WHERE id = ${novoAtivo.id}
      `);

      let centroidLat: number | null = null;
      let centroidLon: number | null = null;

      let resolvedGeojson = geojson;
      if ((!resolvedGeojson || typeof resolvedGeojson !== "object") && cod_imovel && uf) {
        try {
          console.log(`[SICAR Import] Buscando geometria da API para ${cod_imovel}...`);
          const codUf = String(uf).toUpperCase();
          const apiParams = new URLSearchParams({ uf: codUf, limit: "50", include_geometry: "true" });
          if (municipio) apiParams.set("municipio", String(municipio));
          const apiData = await mavrionApiFetch(`/api/sicar/imoveis?${apiParams.toString()}`, 30000);
          if (apiData?.data && Array.isArray(apiData.data)) {
            const match = apiData.data.find((r: any) => r.cod_imovel === cod_imovel);
            if (match) {
              resolvedGeojson = match.geojson || match.geometry || null;
              if (resolvedGeojson) {
                console.log(`[SICAR Import] Geometria encontrada: ${resolvedGeojson.type}, ${JSON.stringify(resolvedGeojson).length} bytes`);
              }
            }
          }
        } catch (geoFetchErr: any) {
          console.warn(`[SICAR Import] Falha ao buscar geometria da API:`, geoFetchErr.message);
        }
      }

      if (resolvedGeojson && typeof resolvedGeojson === "object" && resolvedGeojson.type) {
        const geojsonStr = JSON.stringify(resolvedGeojson);
        if (geojsonStr.length < 5_000_000) {
          try {
            await db.execute(sql`UPDATE assets SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonStr}), 4326) WHERE id = ${novoAtivo.id}`);
          } catch (geoErr: any) {
            console.error(`[SICAR Import] Falha ao salvar geometria para asset ${novoAtivo.id}:`, geoErr.message);
          }
        }

        let ring: number[][] | null = null;
        if (resolvedGeojson.type === 'Polygon' && resolvedGeojson.coordinates?.[0]) {
          ring = resolvedGeojson.coordinates[0];
        } else if (resolvedGeojson.type === 'MultiPolygon' && resolvedGeojson.coordinates?.[0]?.[0]) {
          ring = resolvedGeojson.coordinates[0][0];
        }
        if (ring && ring.length > 0) {
          centroidLon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          centroidLat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        }
      }

      if (centroidLat && centroidLon) {
        await db.execute(sql`
          UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify({ latitude: centroidLat, longitude: centroidLon })}::jsonb
          WHERE id = ${novoAtivo.id}
        `);

        (async () => {
          try {
            console.log(`[Auto-enrich SICAR] Iniciando enriquecimento Embrapa para ativo ${novoAtivo.id}...`);
            const codMunicipio = "";
            const resultado = await enriquecerFazenda({ lat: centroidLat!, lon: centroidLon!, codIBGE: codMunicipio || undefined });

            const embrapaCompat: any = {};
            if (resultado.solo) {
              const s = resultado.solo;
              let classificacao = s.soilClass || 'Não classificado';
              let textura = '';
              if (s.clay !== null) {
                if (s.clay > 60) textura = 'Muito argilosa';
                else if (s.clay > 35) textura = 'Argilosa';
                else if (s.clay > 15) textura = 'Média';
                else textura = 'Arenosa';
              }
              let aptidao = '';
              if (s.phh2o !== null && s.soc !== null) {
                if (s.phh2o >= 5.5 && s.phh2o <= 7.0 && s.soc > 10) aptidao = 'Boa para agricultura';
                else if (s.phh2o >= 4.5 && s.phh2o <= 7.5) aptidao = 'Moderada';
                else aptidao = 'Restrita — necessita correção';
              }
              embrapaCompat.solo = {
                classificacao, textura, aptidao,
                ph: s.phh2o, argila: s.clay, areia: s.sand,
                carbonoOrganico: s.soc, nitrogenio: s.nitrogen, cec: s.cec,
                fonte: 'SoilGrids/ISRIC',
              };
            }
            if (resultado.zarc.length > 0) {
              embrapaCompat.zoneamento = {
                culturas: resultado.zarc.map((z: any) => ({
                  nome: z.cultura, risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : 'medio',
                  epocaPlantio: z.datasPlantio?.join(', ') || '', aptidao: z.aptidao,
                })),
              };
            }
            if (resultado.ndviSatveg && resultado.ndviSatveg.ndviMedio > 0) {
              embrapaCompat.ndvi = {
                ndvi: resultado.ndviSatveg.ndviMedio, evi: resultado.ndviSatveg.eviMedio,
                classificacao: resultado.ndviSatveg.ndviMedio >= 0.7 ? 'Vegetação densa e saudável' : resultado.ndviSatveg.ndviMedio >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
                fonte: resultado.ndviSatveg.fonte,
                periodo: `${resultado.ndviSatveg.dataInicio} a ${resultado.ndviSatveg.dataFim}`,
              };
            }
            if (resultado.clima) {
              const tempMedia = resultado.clima.temperaturaMinMedia && resultado.clima.temperaturaMaxMedia
                ? parseFloat(((resultado.clima.temperaturaMinMedia + resultado.clima.temperaturaMaxMedia) / 2).toFixed(1))
                : 0;
              embrapaCompat.clima = {
                precipitacaoMedia: resultado.clima.precipitacaoMedia, temperaturaMedia: tempMedia,
                temperaturaMax: resultado.clima.temperaturaMaxMedia, temperaturaMin: resultado.clima.temperaturaMinMedia,
                indiceSeca: resultado.resumo || '', fonte: resultado.clima.fonte,
                precipitacaoAnual: resultado.clima.precipitacaoAnual,
                precipitacaoMensal: resultado.clima.precipitacaoMensal,
                temperaturaMensal: resultado.clima.temperaturaMensal,
                mesesSecos: resultado.clima.mesesSecos,
                mesesChuvosos: resultado.clima.mesesChuvosos,
                anoReferencia: resultado.clima.anoReferencia,
              };
            }
            embrapaCompat.scoreAgro = resultado.scoreAgro;
            embrapaCompat.resumo = resultado.resumo;

            const enrichData = {
              embrapa: embrapaCompat,
              agro: resultado,
              agroEnriquecidoEm: new Date().toISOString(),
            };
            await db.execute(sql`
              UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify(enrichData)}::jsonb
              WHERE id = ${novoAtivo.id}
            `);
            console.log(`[Auto-enrich SICAR] Ativo ${novoAtivo.id} enriquecido. Score agro: ${resultado.scoreAgro}`);
          } catch (enrichErr: any) {
            console.warn(`[Auto-enrich SICAR] Falha para ativo ${novoAtivo.id}:`, enrichErr.message);
          }
        })();

        setImmediate(async () => {
          try {
            console.log(`[Auto-ambiental SICAR] Consultando DETER + MapBiomas para ativo ${novoAtivo.id}...`);
            const [deterRes, mapbiomasRes] = await Promise.allSettled([
              consultarDeterINPE(centroidLat!, centroidLon!),
              getUsoTerraMapBiomas(centroidLat!, centroidLon!, cod_imovel || undefined),
            ]);
            const deter = deterRes.status === "fulfilled" ? deterRes.value : null;
            const mapbiomas = mapbiomasRes.status === "fulfilled" ? mapbiomasRes.value : null;
            const ambiental = { deter, mapbiomas, consultadoEm: new Date().toISOString() };
            await db.execute(sql`
              UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify({ ambiental })}::jsonb
              WHERE id = ${novoAtivo.id}
            `);
            console.log(`[Auto-ambiental SICAR] Ativo ${novoAtivo.id}: DETER=${deter?.totalAlertas ?? 'N/A'}, MapBiomas=${mapbiomas?.alertasDesmatamento ?? 'N/A'}`);
          } catch (err: any) {
            console.warn(`[Auto-ambiental SICAR] Falha para ativo ${novoAtivo.id}:`, err.message);
          }
        });
      }

      if (resolvedGeojson && centroidLat && centroidLon) {
        runGeoAnalysisInBackground(novoAtivo.id, resolvedGeojson, areaNum, orgId);
      }

      res.status(201).json(novoAtivo);
    } catch (err: any) {
      console.error("SICAR import error:", err.message);
      res.status(500).json({ message: "Erro ao importar propriedade" });
    }
  });

  app.get("/api/geo/hidrografia", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { bbox } = req.query;
      if (!bbox) return res.status(400).json({ message: "bbox obrigatório" });

      const geoCacheKey = `hidro:${bbox}`;
      const geoCached = await getCached<any>("geo", geoCacheKey);
      if (geoCached) {
        return res.json(geoCached);
      }

      const fetchLayer = async (typeName: string) => {
        const params = new URLSearchParams({
          service: "WFS", version: "2.0.0", request: "GetFeature",
          typeName, outputFormat: "application/json",
          srsName: "EPSG:4326", count: "200",
          bbox: `${bbox},EPSG:4326`,
        });
        const r = await fetch(`${IBGE_WFS}?${params}`, { signal: AbortSignal.timeout(25000) });
        if (!r.ok) return { type: "FeatureCollection", features: [] };
        return r.json();
      };

      const [rios, massas] = await Promise.all([
        fetchLayer("CCAR:BC100_Trecho_Drenagem_L"),
        fetchLayer("CCAR:BC100_Massa_Dagua_A"),
      ]);

      let result: any = { rios, massas, fonte: "IBGE" };

      if ((rios?.features?.length || 0) === 0 && (massas?.features?.length || 0) === 0) {
        const parts = (bbox as string).split(",").map(Number);
        if (parts.length === 4) {
          const cLat = (parts[1] + parts[3]) / 2;
          const cLng = (parts[0] + parts[2]) / 2;
          const padDeg = Math.max(Math.abs(parts[3] - parts[1]), Math.abs(parts[2] - parts[0])) / 2 + 0.05;
          const osmWater = await fetchOSMWater(cLat, cLng, padDeg);
          if (osmWater?.features?.length > 0) {
            const osmRios = osmWater.features.filter((f: any) => f.properties?.waterway);
            const osmMassas = osmWater.features.filter((f: any) => f.properties?.natural && !f.properties?.waterway);
            result = {
              rios: { type: "FeatureCollection", features: osmRios },
              massas: { type: "FeatureCollection", features: osmMassas },
              fonte: "OSM",
            };
          }
        }
      }

      await setCached("geo", geoCacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("Geo hidrografia error:", err.message);
      res.status(502).json({ message: "Erro ao consultar hidrografia" });
    }
  });

  app.get("/api/geo/energia", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { bbox } = req.query;
      if (!bbox) return res.status(400).json({ message: "bbox obrigatório" });

      const energiaCacheKey = `energia:${bbox}`;
      const energiaCached = await getCached<any>("geo", energiaCacheKey);
      if (energiaCached) {
        return res.json(energiaCached);
      }

      const params = new URLSearchParams({
        service: "WFS", version: "2.0.0", request: "GetFeature",
        typeName: "CCAR:BC100_Trecho_Energia_L",
        outputFormat: "application/json", srsName: "EPSG:4326", count: "200",
        bbox: `${bbox},EPSG:4326`,
      });
      let data: any = { type: "FeatureCollection", features: [] };
      let fonte = "IBGE";
      try {
        const r = await fetch(`${IBGE_WFS}?${params}`, { signal: AbortSignal.timeout(25000) });
        if (r.ok) data = await r.json();
      } catch {}

      if ((data?.features?.length || 0) === 0) {
        const parts = (bbox as string).split(",").map(Number);
        if (parts.length === 4) {
          const cLat = (parts[1] + parts[3]) / 2;
          const cLng = (parts[0] + parts[2]) / 2;
          const padDeg = Math.max(Math.abs(parts[3] - parts[1]), Math.abs(parts[2] - parts[0])) / 2 + 0.05;
          const osmPower = await fetchOSMPower(cLat, cLng, padDeg);
          if (osmPower?.features?.length > 0) {
            data = osmPower;
            fonte = "OSM";
          }
        }
      }

      const result = { ...data, fonte };
      await setCached("geo", energiaCacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("Geo energia error:", err.message);
      res.status(502).json({ message: "Erro ao consultar rede elétrica" });
    }
  });

  app.get("/api/geo/elevacao", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { locations } = req.query;
      if (!locations) return res.status(400).json({ message: "locations obrigatório (lat,lng|lat,lng)" });

      const elevCacheKey = `elev:${locations}`;
      const elevCached = await getCached<any>("geo", elevCacheKey);
      if (elevCached) {
        return res.json(elevCached);
      }

      const r = await fetch(`${ELEVATION_API}?locations=${locations}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`Elevation API error: ${r.status}`);
      const data = await r.json();
      await setCached("geo", elevCacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("Geo elevacao error:", err.message);
      res.status(502).json({ message: "Erro ao consultar elevação" });
    }
  });

  app.post("/api/geo/analisar", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { geometry } = req.body;
      if (!geometry || !geometry.coordinates) {
        return res.status(400).json({ message: "Geometria GeoJSON obrigatória" });
      }

      const bbox = bboxFromGeometry(geometry);
      const [centLat, centLng] = centroidFromGeometry(geometry);
      const samplePoints = samplePointsFromGeometry(geometry, 30);
      const rawArea = parseFloat(req.body.areaHa);
      const areaHa = !isNaN(rawArea) && rawArea > 0 ? rawArea : null;

      const bboxExpanded = (() => {
        const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
        const pad = 0.1;
        return `${minLng - pad},${minLat - pad},${maxLng + pad},${maxLat + pad}`;
      })();

      const fetchIBGE = async (typeName: string) => {
        const params = new URLSearchParams({
          service: "WFS", version: "2.0.0", request: "GetFeature",
          typeName, outputFormat: "application/json",
          srsName: "EPSG:4326", count: "200",
          bbox: `${bboxExpanded},EPSG:4326`,
        });
        try {
          const r = await fetch(`${IBGE_WFS}?${params}`, { signal: AbortSignal.timeout(20000) });
          if (!r.ok) return { type: "FeatureCollection", features: [] };
          return r.json();
        } catch { return { type: "FeatureCollection", features: [] }; }
      };

      const locations = samplePoints.map(p => `${p[0]},${p[1]}`).join("|");
      const elevPromise = (async () => {
        try {
          const r = await fetch(`${ELEVATION_API}?locations=${locations}`, { signal: AbortSignal.timeout(15000) });
          if (!r.ok) return null;
          return r.json();
        } catch { return null; }
      })();

      const [riosDataIBGE, massasDataIBGE, energiaDataIBGE, elevData] = await Promise.all([
        fetchIBGE("CCAR:BC100_Trecho_Drenagem_L"),
        fetchIBGE("CCAR:BC100_Massa_Dagua_A"),
        fetchIBGE("CCAR:BC100_Trecho_Energia_L"),
        elevPromise,
      ]);

      let riosData = riosDataIBGE;
      let massasData = massasDataIBGE;
      let energiaData = energiaDataIBGE;
      let fonteHidro = "IBGE";
      let fonteEnergia = "IBGE";

      const ibgeWaterCount = (riosDataIBGE?.features?.length || 0) + (massasDataIBGE?.features?.length || 0);
      const ibgeEnergyCount = energiaDataIBGE?.features?.length || 0;

      if (ibgeWaterCount === 0 || ibgeEnergyCount === 0) {
        const [osmWater, osmPower] = await Promise.all([
          ibgeWaterCount === 0 ? fetchOSMWater(centLat, centLng, 0.15) : Promise.resolve(null),
          ibgeEnergyCount === 0 ? fetchOSMPower(centLat, centLng, 0.15) : Promise.resolve(null),
        ]);
        if (osmWater && osmWater.features?.length > 0) {
          riosData = osmWater;
          massasData = { type: "FeatureCollection", features: [] };
          fonteHidro = "OSM";
          console.log(`[Geo] IBGE sem hidrografia — OSM retornou ${osmWater.features.length} features`);
        }
        if (osmPower && osmPower.features?.length > 0) {
          energiaData = osmPower;
          fonteEnergia = "OSM";
          console.log(`[Geo] IBGE sem energia — OSM retornou ${osmPower.features.length} features`);
        }
      }

      const temRio = fonteHidro === "OSM"
        ? (riosData?.features?.length || 0) > 0
        : (riosDataIBGE?.features?.length || 0) > 0;
      const temLago = fonteHidro === "OSM"
        ? (riosData?.features || []).some((f: any) => f.properties?.natural === "water" || f.properties?.natural === "lake" || f.properties?.natural === "reservoir")
        : (massasDataIBGE?.features?.length || 0) > 0;
      const temEnergia = (energiaData?.features?.length || 0) > 0;
      const qtdRios = fonteHidro === "OSM"
        ? (riosData?.features || []).filter((f: any) => f.properties?.waterway).length
        : (riosDataIBGE?.features?.length || 0);
      const qtdLagos = fonteHidro === "OSM"
        ? (riosData?.features || []).filter((f: any) => f.properties?.natural).length
        : (massasDataIBGE?.features?.length || 0);
      const qtdEnergia = energiaData?.features?.length || 0;

      const allWaterData = fonteHidro === "OSM"
        ? riosData
        : {
            type: "FeatureCollection",
            features: [...(riosData?.features || []), ...(massasData?.features || [])],
          };
      const distAguaM = nearestFeatureDistance(centLat, centLng, allWaterData);
      const distEnergiaM = nearestFeatureDistance(centLat, centLng, energiaData);
      const scoreEnergia = classifyEnergia(distEnergiaM, temEnergia);

      let altMin: number | null = null, altMax: number | null = null, altMedia: number | null = null;
      let declivMed: number | null = null;
      const elevs: number[] = [];
      if (elevData?.results) {
        for (const r of elevData.results) {
          if (r.elevation != null) elevs.push(r.elevation);
        }
        if (elevs.length > 0) {
          altMin = Math.min(...elevs);
          altMax = Math.max(...elevs);
          altMedia = Math.round(elevs.reduce((a, b) => a + b, 0) / elevs.length);
          declivMed = estimateDeclivity(samplePoints, elevs);
        }
      }

      const { score, breakdown } = computeGeoScore({
        temRio, temLago, distAguaM,
        temEnergia, distEnergiaM,
        altMedia, declivMed,
        areaHa,
      });

      const analysis = {
        temRio, temLago, temEnergia,
        qtdRios, qtdLagos, qtdEnergia,
        distAguaM, distEnergiaM, scoreEnergia,
        altMin, altMax, altMedia, declivMed,
        score, breakdown,
        fonteHidro, fonteEnergia,
        centroid: { lat: centLat, lng: centLng },
        bbox,
        layers: {
          rios: riosData,
          massas: massasData,
          energia: energiaData,
        },
      };

      res.json(analysis);
    } catch (err: any) {
      console.error("Geo analisar error:", err.message);
      res.status(500).json({ message: "Erro na análise geoespacial" });
    }
  });

  app.get("/api/geo/imported", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const result = await db.select({ id: assets.id, carCodImovel: sql<string>`car_cod_imovel` })
        .from(assets)
        .where(sql`car_cod_imovel IS NOT NULL AND org_id = ${orgId}`);
      const map: Record<string, number> = {};
      for (const r of result) {
        if (r.carCodImovel) map[r.carCodImovel] = r.id;
      }
      res.json(map);
    } catch (err: any) {
      res.status(500).json({ message: "Erro interno" });
    }
  });

  app.post("/api/geo/import-fazenda", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { feature, analysis } = req.body;
      if (!feature?.properties) {
        return res.status(400).json({ message: "Feature GeoJSON obrigatória" });
      }

      const orgId = getOrgId(req);
      const props = feature.properties;
      const codImovel = props.cod_imovel || props.COD_IMOVEL || props.cod_car || "";

      if (codImovel) {
        const existing = await db.select({ id: assets.id })
          .from(assets)
          .where(sql`car_cod_imovel = ${codImovel} AND org_id = ${orgId}`)
          .limit(1);
        if (existing.length > 0) {
          return res.status(409).json({ message: "Imóvel já importado", assetId: existing[0].id });
        }
      }

      const municipio = props.municipio || props.MUNICIPIO || props.nom_municipio || "";
      const uf = props.cod_estado || props.uf || props.UF || "";
      const areaRaw = props.num_area || props.area_ha || props.AREA || null;
      const area = areaRaw != null ? parseFloat(String(areaRaw)) : null;
      const titular = props.nom_imovel || props.titular || props.NOM_IMOVEL || "";
      const status = props.ind_status || props.STATUS || props.des_condic || "";
      const tipo = props.ind_tipo || props.tipo || "";

      let linkedCompanyId = null;
      if (titular) {
        const allCompanies = await storage.getCompanies();
        const tLower = titular.toLowerCase();
        const match = allCompanies.find((c: any) => {
          return (c.legalName && c.legalName.toLowerCase().includes(tLower)) ||
                 (c.tradeName && c.tradeName.toLowerCase().includes(tLower));
        });
        if (match) linkedCompanyId = match.id;
      }

      const geomJson = feature.geometry ? JSON.stringify(feature.geometry) : null;

      let centroidLat: number | null = null;
      let centroidLon: number | null = null;
      if (feature.geometry) {
        const geom = feature.geometry;
        let ring: number[][] | null = null;
        if (geom.type === 'Polygon' && geom.coordinates?.[0]) {
          ring = geom.coordinates[0];
        } else if (geom.type === 'MultiPolygon' && geom.coordinates?.[0]?.[0]) {
          ring = geom.coordinates[0][0];
        }
        if (ring && ring.length > 0) {
          centroidLon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
          centroidLat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
        }
      }
      if (analysis?.centroid) {
        centroidLat = analysis.centroid.lat || analysis.centroid[1] || centroidLat;
        centroidLon = analysis.centroid.lng || analysis.centroid.lon || analysis.centroid[0] || centroidLon;
      } else if (analysis?.centroide) {
        centroidLat = analysis.centroide.lat || analysis.centroide[1] || centroidLat;
        centroidLon = analysis.centroide.lon || analysis.centroide[0] || centroidLon;
      }

      const codMunicipio = props.cod_municipio || props.COD_MUNICIPIO || props.cod_ibge || "";
      const asset = await storage.createAsset({
        orgId,
        type: "TERRA",
        title: `Fazenda CAR — ${municipio}/${uf}`.slice(0, 200),
        description: `Imóvel rural do CAR${titular ? ` (${titular})` : ""}. Área: ${area ? `${Number(area).toLocaleString("pt-BR")} ha` : "N/D"}. Status: ${status || "N/D"}`,
        location: `${municipio}/${uf}`,
        municipio: municipio || null,
        estado: uf || null,
        areaHa: area && !isNaN(area) ? area : null,
        linkedCompanyId,
        tags: ["CAR", "Geo Rural", "Importado"],
        camposEspecificos: {
          latitude: centroidLat,
          longitude: centroidLon,
          codigoIbge: codMunicipio || null,
        } as any,
        attributesJson: {
          carCodImovel: codImovel,
          carMunicipio: municipio,
          carUf: uf,
          carTitular: titular,
          carStatus: status,
          carTipo: tipo,
          carArea: area,
          geoTemRio: analysis?.temRio || false,
          geoTemLago: analysis?.temLago || false,
          geoTemEnergia: analysis?.temEnergia || false,
          geoAltMedia: analysis?.altMedia || null,
          geoAltMin: analysis?.altMin || null,
          geoAltMax: analysis?.altMax || null,
          geoScore: analysis?.score || null,
          geoDistEnergia: analysis?.distEnergiaM || null,
          importadoEm: new Date().toISOString(),
        },
      });

      if (codImovel) {
        await db.execute(sql`UPDATE assets SET car_cod_imovel = ${codImovel} WHERE id = ${asset.id}`);
      }
      if (geomJson) {
        await db.execute(sql`UPDATE assets SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326) WHERE id = ${asset.id}`);
      }

      if (analysis) {
        const scoreEn = analysis.scoreEnergia || classifyEnergia(analysis.distEnergiaM ?? null, analysis.temEnergia || false);
        const declivVal = analysis.declivMed ?? null;
        const { score: geoScoreVal } = computeGeoScore({
          temRio: analysis.temRio || false,
          temLago: analysis.temLago || false,
          distAguaM: analysis.distAguaM ?? null,
          temEnergia: analysis.temEnergia || false,
          distEnergiaM: analysis.distEnergiaM ?? null,
          altMedia: analysis.altMedia ?? null,
          declivMed: declivVal,
          areaHa: area,
        });
        await db.execute(sql`
          UPDATE assets SET
            geo_alt_med = ${analysis.altMedia ?? null},
            geo_alt_min = ${analysis.altMin ?? null},
            geo_alt_max = ${analysis.altMax ?? null},
            geo_decliv_med = ${declivVal},
            geo_tem_rio = ${analysis.temRio || false},
            geo_tem_lago = ${analysis.temLago || false},
            geo_dist_agua_m = ${analysis.distAguaM ?? null},
            geo_tem_energia = ${analysis.temEnergia || false},
            geo_dist_energia_m = ${analysis.distEnergiaM ?? null},
            geo_score_energia = ${scoreEn},
            geo_score = ${geoScoreVal},
            geo_analyzed_at = NOW()
          WHERE id = ${asset.id}
        `);
      }

      if (!analysis && geomJson && feature.geometry) {
        runGeoAnalysisInBackground(asset.id, feature.geometry, area && !isNaN(area) ? area : null, orgId);
      }

      if (centroidLat && centroidLon) {
        (async () => {
          try {
            console.log(`[Auto-enrich] Iniciando enriquecimento Embrapa para ativo ${asset.id}...`);
            const resultado = await enriquecerFazenda({ lat: centroidLat!, lon: centroidLon!, codIBGE: codMunicipio || undefined });

            const embrapaCompat: any = {};
            if (resultado.solo) {
              const s = resultado.solo;
              let classificacao = s.soilClass || 'Não classificado';
              let textura = '';
              if (s.clay !== null) {
                if (s.clay > 60) textura = 'Muito argilosa';
                else if (s.clay > 35) textura = 'Argilosa';
                else if (s.clay > 15) textura = 'Média';
                else textura = 'Arenosa';
              }
              let aptidao = '';
              if (s.phh2o !== null && s.soc !== null) {
                if (s.phh2o >= 5.5 && s.phh2o <= 7.0 && s.soc > 10) aptidao = 'Boa para agricultura';
                else if (s.phh2o >= 4.5 && s.phh2o <= 7.5) aptidao = 'Moderada';
                else aptidao = 'Restrita — necessita correção';
              }
              embrapaCompat.solo = {
                classificacao, textura, aptidao,
                ph: s.phh2o, argila: s.clay, areia: s.sand,
                carbonoOrganico: s.soc, nitrogenio: s.nitrogen, cec: s.cec,
                fonte: 'SoilGrids/ISRIC',
              };
            }
            if (resultado.zarc.length > 0) {
              embrapaCompat.zoneamento = {
                culturas: resultado.zarc.map(z => ({
                  nome: z.cultura, risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : 'medio',
                  epocaPlantio: z.datasPlantio?.join(', ') || '', aptidao: z.aptidao,
                })),
              };
            }
            if (resultado.ndviSatveg && resultado.ndviSatveg.ndviMedio > 0) {
              embrapaCompat.ndvi = {
                ndvi: resultado.ndviSatveg.ndviMedio, evi: resultado.ndviSatveg.eviMedio,
                classificacao: resultado.ndviSatveg.ndviMedio >= 0.7 ? 'Vegetação densa e saudável' : resultado.ndviSatveg.ndviMedio >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
                fonte: resultado.ndviSatveg.fonte,
                periodo: `${resultado.ndviSatveg.dataInicio} a ${resultado.ndviSatveg.dataFim}`,
              };
            }
            if (resultado.clima) {
              const tempMedia = resultado.clima.temperaturaMinMedia && resultado.clima.temperaturaMaxMedia
                ? parseFloat(((resultado.clima.temperaturaMinMedia + resultado.clima.temperaturaMaxMedia) / 2).toFixed(1))
                : 0;
              embrapaCompat.clima = {
                precipitacaoMedia: resultado.clima.precipitacaoMedia, temperaturaMedia: tempMedia,
                temperaturaMax: resultado.clima.temperaturaMaxMedia, temperaturaMin: resultado.clima.temperaturaMinMedia,
                indiceSeca: resultado.resumo || '', fonte: resultado.clima.fonte,
                precipitacaoAnual: resultado.clima.precipitacaoAnual,
                precipitacaoMensal: resultado.clima.precipitacaoMensal,
                temperaturaMensal: resultado.clima.temperaturaMensal,
                mesesSecos: resultado.clima.mesesSecos,
                mesesChuvosos: resultado.clima.mesesChuvosos,
                anoReferencia: resultado.clima.anoReferencia,
              };
            }
            embrapaCompat.scoreAgro = resultado.scoreAgro;
            embrapaCompat.resumo = resultado.resumo;

            const enrichData = {
              embrapa: embrapaCompat,
              agro: resultado,
              agroEnriquecidoEm: new Date().toISOString(),
            };
            await db.execute(sql`
              UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify(enrichData)}::jsonb
              WHERE id = ${asset.id}
            `);
            console.log(`[Auto-enrich] Ativo ${asset.id} enriquecido com sucesso. Score agro: ${resultado.scoreAgro}`);
          } catch (enrichErr: any) {
            console.warn(`[Auto-enrich] Falha no enriquecimento do ativo ${asset.id}:`, enrichErr.message);
          }
        })();

        setImmediate(async () => {
          try {
            console.log(`[Auto-ambiental] Consultando DETER + MapBiomas para ativo ${asset.id}...`);
            const [deterRes, mapbiomasRes] = await Promise.allSettled([
              consultarDeterINPE(centroidLat!, centroidLon!),
              getUsoTerraMapBiomas(centroidLat!, centroidLon!, asset.carCodImovel || undefined),
            ]);
            const deter = deterRes.status === "fulfilled" ? deterRes.value : null;
            const mapbiomas = mapbiomasRes.status === "fulfilled" ? mapbiomasRes.value : null;
            const ambiental = { deter, mapbiomas, consultadoEm: new Date().toISOString() };

            await db.execute(sql`
              UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify({ ambiental })}::jsonb
              WHERE id = ${asset.id}
            `);
            console.log(`[Auto-ambiental] Ativo ${asset.id}: DETER=${deter?.totalAlertas ?? 'N/A'}, MapBiomas=${mapbiomas?.alertasDesmatamento ?? 'N/A'}`);
          } catch (err: any) {
            console.warn(`[Auto-ambiental] Falha para ativo ${asset.id}:`, err.message);
          }
        });
      }

      if (codMunicipio && uf) {
        (async () => {
          try {
            const { executarCrawlerCAF } = await import("../services/caf-crawler");
            const orgIdVal = getOrgId(req);
            const jobId = `auto-${asset.id}-${Date.now()}`;
            const job = {
              id: jobId, orgId: String(orgIdVal), modo: "paginado" as const,
              uf, ano: new Date().getFullYear(), mes: 1,
              seqInicio: 1, seqFim: 20, municipio: municipio || undefined,
              codIBGE: codMunicipio, areaMinHa: 0, areaMaxHa: 0,
              delayMs: 1100, apenasProprietario: false, apenasAtivos: true,
              apenasComPronaf: false, status: "pendente" as const,
              progresso: 0, totalVaridos: 0, totalEncontrados: 0,
              totalSalvos: 0, totalErros: 0, iniciadoEm: null, concluidoEm: null,
            };
            console.log(`[Auto-CAF] Iniciando varredura CAF para ${municipio}/${uf} (codIBGE=${codMunicipio})...`);
            await executarCrawlerCAF(
              job,
              () => {},
              async (lead) => {
                try {
                  const [existente] = await db
                    .select({ id: mavrionCafRegistros.id })
                    .from(mavrionCafRegistros)
                    .where(and(eq(mavrionCafRegistros.orgId, orgIdVal), eq(mavrionCafRegistros.numeroUFPA, lead.nufpa)))
                    .limit(1);
                  if (!existente) {
                    await db.insert(mavrionCafRegistros).values({
                      orgId: orgIdVal, nomeTitular: lead.nome,
                      cpfTitular: lead.cpfMascarado || null, numeroUFPA: lead.nufpa,
                      municipio: lead.municipio || null, uf: lead.uf || null,
                      areaHa: lead.areaHa, condicaoPosse: lead.condicaoPosse || null,
                      atividadePrincipal: lead.atividade || null,
                      enquadramentoPronaf: lead.enquadramentoPronaf ? "Sim" : "Não",
                      composicaoFamiliar: lead.membros || [],
                      entidadeNome: lead.entidadeCadastradora || null,
                      validade: lead.dataValidade || null,
                      dataInscricao: lead.dataInscricao || null,
                      numImoveis: lead.numImoveis || 1,
                      status: lead.situacao === "ATIVA" ? "ativo" : lead.situacao === "INATIVA" ? "vencido" : "pendente",
                      mavrionProfile: lead.mavrionProfile || "baixo",
                      classificacao: "pendente" as const,
                      dadosExtras: { idUfpa: lead.idUfpa, grauParentesco: lead.grauParentesco, situacaoOriginal: lead.situacao, extraidoEm: lead.extraidoEm },
                      companyId: null,
                    });
                  }
                } catch (e: any) {
                  console.error(`[Auto-CAF] Erro ao salvar ${lead.nufpa}:`, e.message);
                }
              }
            );
            console.log(`[Auto-CAF] Varredura CAF concluída para ${municipio}/${uf}. Encontrados: ${job.totalEncontrados}`);
          } catch (cafErr: any) {
            console.warn(`[Auto-CAF] Falha na varredura CAF para ativo ${asset.id}:`, cafErr.message);
          }
        })();
      }

      res.status(201).json(asset);
    } catch (err: any) {
      console.error("Geo import fazenda error:", err.message);
      res.status(500).json({ message: "Erro ao importar fazenda" });
    }
  });

  app.post("/api/geo/auto-analyze", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { assetId } = req.body;
      if (!assetId) return res.status(400).json({ message: "assetId obrigatório" });
      const orgId = getOrgId(req);

      const [asset] = await db.select({
        id: assets.id, orgId: assets.orgId, areaHa: assets.areaHa,
        geoScore: sql<number>`geo_score`,
        camposEspecificos: assets.camposEspecificos,
      }).from(assets).where(sql`id = ${assetId}`).limit(1);
      if (!asset || asset.orgId !== orgId) return res.status(404).json({ message: "Ativo não encontrado" });

      if (asset.geoScore) return res.json({ success: true, message: "Análise já existe", alreadyAnalyzed: true });

      const [geomRow] = (await db.execute(sql`SELECT ST_AsGeoJSON(geom) as geojson FROM assets WHERE id = ${assetId} AND geom IS NOT NULL`)).rows;
      if (!geomRow || !(geomRow as any).geojson) return res.status(400).json({ message: "Ativo sem geometria" });

      const geometry = JSON.parse((geomRow as any).geojson);
      runGeoAnalysisInBackground(assetId, geometry, asset.areaHa, orgId);

      const ce = (asset.camposEspecificos || {}) as any;
      if (ce.latitude && ce.longitude && !ce.embrapa) {
        setImmediate(async () => {
          try {
            const resultado = await enriquecerFazenda({ lat: ce.latitude, lon: ce.longitude, codIBGE: ce.codigoIbge || undefined });
            const embrapaCompat: any = {};
            if (resultado.solo) {
              const s = resultado.solo;
              let textura = '';
              if (s.clay !== null) {
                if (s.clay > 60) textura = 'Muito argilosa';
                else if (s.clay > 35) textura = 'Argilosa';
                else if (s.clay > 15) textura = 'Média';
                else textura = 'Arenosa';
              }
              let aptidao = '';
              if (s.phh2o !== null && s.soc !== null) {
                if (s.phh2o >= 5.5 && s.phh2o <= 7.0 && s.soc > 10) aptidao = 'Boa para agricultura';
                else if (s.phh2o >= 4.5 && s.phh2o <= 7.5) aptidao = 'Moderada';
                else aptidao = 'Restrita — necessita correção';
              }
              embrapaCompat.solo = {
                classificacao: s.soilClass || 'Não classificado', textura, aptidao,
                ph: s.phh2o, argila: s.clay, areia: s.sand,
                carbonoOrganico: s.soc, nitrogenio: s.nitrogen, cec: s.cec,
                fonte: 'SoilGrids/ISRIC',
              };
            }
            if (resultado.zarc?.length > 0) {
              embrapaCompat.zoneamento = {
                culturas: resultado.zarc.map((z: any) => ({
                  nome: z.cultura, risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : 'medio',
                  epocaPlantio: z.datasPlantio?.join(', ') || '', aptidao: z.aptidao,
                })),
              };
            }
            embrapaCompat.scoreAgro = resultado.scoreAgro;
            embrapaCompat.resumo = resultado.resumo;

            await db.execute(sql`
              UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify({
                embrapa: embrapaCompat, agro: resultado, agroEnriquecidoEm: new Date().toISOString(),
              })}::jsonb WHERE id = ${assetId}
            `);
            console.log(`[Auto-analyze] Ativo ${assetId} enriquecido agro. Score: ${resultado.scoreAgro}`);
          } catch (err: any) {
            console.warn(`[Auto-analyze] Falha agro ativo ${assetId}:`, err.message);
          }
        });
      }

      res.json({ success: true, message: "Análise iniciada em background", triggered: true });
    } catch (err: any) {
      console.error("[Auto-analyze] Erro:", err.message);
      res.status(500).json({ message: "Erro ao iniciar auto-análise" });
    }
  });

  app.post("/api/geo/persist-analysis", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { assetId, analysis } = req.body;
      if (!assetId || !analysis) return res.status(400).json({ message: "assetId e analysis obrigatórios" });

      const [existing] = await db.select({ id: assets.id, areaHa: assets.areaHa, orgId: assets.orgId, camposEspecificos: assets.camposEspecificos, municipio: assets.municipio, estado: assets.estado })
        .from(assets).where(sql`id = ${assetId}`).limit(1);
      if (!existing || existing.orgId !== getOrgId(req)) return res.status(404).json({ message: "Ativo não encontrado" });

      if (!existing.areaHa) {
        try {
          const [areaRow] = (await db.execute(sql`SELECT ROUND(CAST(ST_Area(ST_Transform(geom, ${sql.raw(utmSridSqlExpr("geom"))})) / 10000 AS numeric), 2) as calc_area FROM assets WHERE id = ${assetId} AND geom IS NOT NULL`)).rows;
          if (areaRow && (areaRow as any).calc_area) {
            const calcArea = parseFloat((areaRow as any).calc_area);
            if (calcArea > 0) {
              await db.execute(sql`UPDATE assets SET area_ha = ${calcArea} WHERE id = ${assetId}`);
              existing.areaHa = calcArea;
            }
          }
        } catch {}
      }

      const scoreEn = analysis.scoreEnergia || classifyEnergia(analysis.distEnergiaM ?? null, analysis.temEnergia || false);
      const declivVal = analysis.declivMed ?? null;
      const { score: geoScoreVal } = computeGeoScore({
        temRio: analysis.temRio || false,
        temLago: analysis.temLago || false,
        distAguaM: analysis.distAguaM ?? null,
        temEnergia: analysis.temEnergia || false,
        distEnergiaM: analysis.distEnergiaM ?? null,
        altMedia: analysis.altMedia ?? null,
        declivMed: declivVal,
        areaHa: existing.areaHa,
      });

      let ibgeCode: string | null = null;
      let resolvedMunicipio: string | null = null;
      const ce = existing.camposEspecificos ?? {};
      if ((!ce.codigoIbge || !existing.municipio) && analysis.centroid) {
        const cLat = analysis.centroid.lat || analysis.centroid[1];
        const cLon = analysis.centroid.lng || analysis.centroid.lon || analysis.centroid[0];
        if (cLat && cLon) {
          try {
            const munRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${cLat}&lon=${cLon}&format=json&zoom=10&extratags=1`, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "MavrionConect/1.0" },
            });
            if (munRes.ok) {
              const munData = await munRes.json();
              const extratags = munData.extratags || {};
              ibgeCode = extratags["IBGE:GEOCODIGO"] || extratags["ibge:geocodigo"] || null;
              const addr = munData.address || {};
              resolvedMunicipio = addr.city || addr.town || addr.municipality || addr.village || null;
            }
          } catch (e: any) {
            console.warn("[persist-analysis] Falha ao buscar IBGE code:", e.message);
          }
        }
      }

      const centLat = analysis.centroid?.lat || analysis.centroid?.[1] || ce.latitude || null;
      const centLon = analysis.centroid?.lng || analysis.centroid?.lon || analysis.centroid?.[0] || ce.longitude || null;
      const ceUpdate: Record<string, any> = {};
      if (centLat && !ce.latitude) ceUpdate.latitude = centLat;
      if (centLon && !ce.longitude) ceUpdate.longitude = centLon;
      if (ibgeCode) ceUpdate.codigoIbge = ibgeCode;

      await db.execute(sql`
        UPDATE assets SET
          geo_alt_med = ${analysis.altMedia ?? null},
          geo_alt_min = ${analysis.altMin ?? null},
          geo_alt_max = ${analysis.altMax ?? null},
          geo_decliv_med = ${declivVal},
          geo_tem_rio = ${analysis.temRio || false},
          geo_tem_lago = ${analysis.temLago || false},
          geo_dist_agua_m = ${analysis.distAguaM ?? null},
          geo_tem_energia = ${analysis.temEnergia || false},
          geo_dist_energia_m = ${analysis.distEnergiaM ?? null},
          geo_score_energia = ${scoreEn},
          geo_score = ${geoScoreVal},
          geo_analyzed_at = NOW(),
          attributes_json = attributes_json || ${JSON.stringify({
            geoTemRio: analysis.temRio || false,
            geoTemLago: analysis.temLago || false,
            geoTemEnergia: analysis.temEnergia || false,
            geoAltMedia: analysis.altMedia ?? null,
            geoAltMin: analysis.altMin ?? null,
            geoAltMax: analysis.altMax ?? null,
            geoDeclivMed: declivVal,
            geoDistAguaM: analysis.distAguaM ?? null,
            geoDistEnergiaM: analysis.distEnergiaM ?? null,
            geoScoreEnergia: scoreEn,
            geoScore: geoScoreVal,
          })}::jsonb
          ${Object.keys(ceUpdate).length > 0 ? sql`, campos_especificos = campos_especificos || ${JSON.stringify(ceUpdate)}::jsonb` : sql``}
          ${resolvedMunicipio && !existing.municipio ? sql`, municipio = ${resolvedMunicipio}, location = ${resolvedMunicipio + '/' + (existing.estado || '')}` : sql``}
        WHERE id = ${assetId}
      `);

      res.json({ success: true, geoScore: geoScoreVal, scoreEnergia: scoreEn, ibgeCode, municipio: resolvedMunicipio });
    } catch (err: any) {
      console.error("Geo persist error:", err.message);
      res.status(500).json({ message: "Erro ao persistir análise" });
    }
  });

  app.get("/api/geo/ranking", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const { minArea, maxArea, minScore, temAgua, temEnergia, scoreEnergia, altMin, altMax, estado, orderBy, limit: lim, offset: off } = req.query as Record<string, string>;

      const conditions: any[] = [
        sql`org_id = ${orgId}`,
        sql`type = 'TERRA'`,
        sql`geo_score IS NOT NULL`,
      ];

      const pf = (v: string | undefined) => { const n = parseFloat(v || ""); return isNaN(n) ? null : n; };
      const pi = (v: string | undefined) => { const n = parseInt(v || ""); return isNaN(n) ? null : n; };
      if (pf(minArea) !== null) conditions.push(sql`area_ha >= ${pf(minArea)}`);
      if (pf(maxArea) !== null) conditions.push(sql`area_ha <= ${pf(maxArea)}`);
      if (pi(minScore) !== null) conditions.push(sql`geo_score >= ${pi(minScore)}`);
      if (temAgua === "true") conditions.push(sql`(geo_tem_rio = true OR geo_tem_lago = true)`);
      if (temEnergia === "true") conditions.push(sql`geo_tem_energia = true`);
      if (scoreEnergia && ["ALTA", "MEDIA", "BAIXA"].includes(scoreEnergia)) conditions.push(sql`geo_score_energia = ${scoreEnergia}`);
      if (pf(altMin) !== null) conditions.push(sql`geo_alt_med >= ${pf(altMin)}`);
      if (pf(altMax) !== null) conditions.push(sql`geo_alt_med <= ${pf(altMax)}`);
      if (estado) conditions.push(sql`estado = ${estado}`);

      const whereClause = sql.join(conditions, sql` AND `);

      let orderClause = sql`geo_score DESC`;
      if (orderBy === "area") orderClause = sql`area_ha DESC NULLS LAST`;
      else if (orderBy === "altitude") orderClause = sql`geo_alt_med ASC NULLS LAST`;
      else if (orderBy === "declivity") orderClause = sql`geo_decliv_med ASC NULLS LAST`;

      const limitVal = Math.min(parseInt(lim || "50"), 200);
      const offsetVal = parseInt(off || "0");

      const countResult = await db.execute(sql`SELECT count(*)::int as total FROM assets WHERE ${whereClause}`);
      const total = (countResult.rows[0] as any)?.total || 0;

      const rows = await db.execute(sql`
        SELECT id, title, municipio, estado, area_ha,
               geo_alt_med, geo_alt_min, geo_alt_max, geo_decliv_med,
               geo_tem_rio, geo_tem_lago, geo_dist_agua_m,
               geo_tem_energia, geo_dist_energia_m, geo_score_energia,
               geo_score, geo_analyzed_at, car_cod_imovel
        FROM assets
        WHERE ${whereClause}
        ORDER BY ${orderClause}
        LIMIT ${limitVal} OFFSET ${offsetVal}
      `);

      const stats = await db.execute(sql`
        SELECT
          count(*)::int as total_analyzed,
          round(avg(geo_score))::int as avg_score,
          round(100.0 * count(*) FILTER (WHERE geo_tem_rio OR geo_tem_lago) / GREATEST(count(*), 1))::int as pct_agua,
          round(100.0 * count(*) FILTER (WHERE geo_tem_energia) / GREATEST(count(*), 1))::int as pct_energia
        FROM assets
        WHERE org_id = ${orgId} AND type = 'TERRA' AND geo_score IS NOT NULL
      `);

      res.json({
        items: rows.rows,
        total,
        stats: stats.rows[0] || { total_analyzed: 0, avg_score: 0, pct_agua: 0, pct_energia: 0 },
      });
    } catch (err: any) {
      console.error("Geo ranking error:", err.message);
      res.status(500).json({ message: "Erro ao buscar ranking" });
    }
  });

  app.post("/api/geo/batch-analyze", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const orgId = getOrgId(req);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const candidates = await db.execute(sql`
        SELECT id, area_ha, ST_AsGeoJSON(geom)::json as geometry
        FROM assets
        WHERE org_id = ${orgId}
          AND type = 'TERRA'
          AND geom IS NOT NULL
          AND (geo_analyzed_at IS NULL OR geo_analyzed_at < ${thirtyDaysAgo}::timestamp)
        LIMIT 50
      `);

      const total = candidates.rows.length;
      sendEvent({ type: "start", total });

      if (total === 0) {
        sendEvent({ type: "complete", analyzed: 0, skipped: 0, errors: 0 });
        res.end();
        return;
      }

      let analyzed = 0, errors = 0;

      for (let i = 0; i < total; i++) {
        const row = candidates.rows[i] as any;
        sendEvent({ type: "progress", current: i + 1, total, assetId: row.id });

        try {
          const geometry = row.geometry;
          const bbox = bboxFromGeometry(geometry);
          const [centLat, centLng] = centroidFromGeometry(geometry);
          const samplePts = samplePointsFromGeometry(geometry, 30);

          const bboxExp = (() => {
            const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
            const pad = 0.1;
            return `${minLng - pad},${minLat - pad},${maxLng + pad},${maxLat + pad}`;
          })();

          const fetchIBGE = async (typeName: string) => {
            const params = new URLSearchParams({
              service: "WFS", version: "2.0.0", request: "GetFeature",
              typeName, outputFormat: "application/json",
              srsName: "EPSG:4326", count: "200",
              bbox: `${bboxExp},EPSG:4326`,
            });
            try {
              const r = await fetch(`${IBGE_WFS}?${params}`, { signal: AbortSignal.timeout(20000) });
              if (!r.ok) return { type: "FeatureCollection", features: [] };
              return r.json();
            } catch { return { type: "FeatureCollection", features: [] }; }
          };

          const locations = samplePts.map(p => `${p[0]},${p[1]}`).join("|");
          const elevPromise = (async () => {
            try {
              const r = await fetch(`${ELEVATION_API}?locations=${locations}`, { signal: AbortSignal.timeout(15000) });
              if (!r.ok) return null;
              return r.json();
            } catch { return null; }
          })();

          const [riosDataIBGE2, massasDataIBGE2, energiaDataIBGE2, elevData] = await Promise.all([
            fetchIBGE("CCAR:BC100_Trecho_Drenagem_L"),
            fetchIBGE("CCAR:BC100_Massa_Dagua_A"),
            fetchIBGE("CCAR:BC100_Trecho_Energia_L"),
            elevPromise,
          ]);

          let riosDataB = riosDataIBGE2, massasDataB = massasDataIBGE2, energiaDataB = energiaDataIBGE2;
          const ibgeWC = (riosDataIBGE2?.features?.length || 0) + (massasDataIBGE2?.features?.length || 0);
          const ibgeEC = energiaDataIBGE2?.features?.length || 0;
          if (ibgeWC === 0 || ibgeEC === 0) {
            const [osmW, osmP] = await Promise.all([
              ibgeWC === 0 ? fetchOSMWater(centLat, centLng, 0.15) : Promise.resolve(null),
              ibgeEC === 0 ? fetchOSMPower(centLat, centLng, 0.15) : Promise.resolve(null),
            ]);
            if (osmW && osmW.features?.length > 0) {
              const ww = osmW.features.filter((f: any) => f.properties?.waterway);
              const nw = osmW.features.filter((f: any) => f.properties?.natural && !f.properties?.waterway);
              riosDataB = { type: "FeatureCollection", features: ww };
              massasDataB = { type: "FeatureCollection", features: nw };
            }
            if (osmP && osmP.features?.length > 0) { energiaDataB = osmP; }
          }

          const temRio = (riosDataB?.features?.length || 0) > 0;
          const temLago = (massasDataB?.features?.length || 0) > 0;
          const temEnergia = (energiaDataB?.features?.length || 0) > 0;

          const allWater = { type: "FeatureCollection", features: [...(riosDataB?.features || []), ...(massasDataB?.features || [])] };
          const distAguaM = nearestFeatureDistance(centLat, centLng, allWater);
          const distEnergiaM = nearestFeatureDistance(centLat, centLng, energiaDataB);
          const scoreEn = classifyEnergia(distEnergiaM, temEnergia);

          let altMin: number | null = null, altMax: number | null = null, altMedia: number | null = null;
          let declivMed: number | null = null;
          if (elevData?.results) {
            const elevs = elevData.results.map((r: any) => r.elevation).filter((e: any) => e != null);
            if (elevs.length > 0) {
              altMin = Math.min(...elevs);
              altMax = Math.max(...elevs);
              altMedia = Math.round(elevs.reduce((a: number, b: number) => a + b, 0) / elevs.length);
              declivMed = estimateDeclivity(samplePts, elevs);
            }
          }

          const areaHa = row.area_ha ? parseFloat(row.area_ha) : null;
          const { score: geoScoreVal } = computeGeoScore({
            temRio, temLago, distAguaM,
            temEnergia, distEnergiaM,
            altMedia, declivMed, areaHa,
          });

          await db.execute(sql`
            UPDATE assets SET
              geo_alt_med = ${altMedia}, geo_alt_min = ${altMin}, geo_alt_max = ${altMax},
              geo_decliv_med = ${declivMed},
              geo_tem_rio = ${temRio}, geo_tem_lago = ${temLago}, geo_dist_agua_m = ${distAguaM},
              geo_tem_energia = ${temEnergia}, geo_dist_energia_m = ${distEnergiaM},
              geo_score_energia = ${scoreEn}, geo_score = ${geoScoreVal},
              geo_analyzed_at = NOW()
            WHERE id = ${row.id}
          `);

          analyzed++;
          sendEvent({ type: "analyzed", assetId: row.id, score: geoScoreVal });
        } catch (e: any) {
          errors++;
          sendEvent({ type: "error", assetId: row.id, message: e.message });
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 1100));
      }

      sendEvent({ type: "complete", analyzed, skipped: 0, errors });
      res.end();
    } catch (err: any) {
      console.error("Geo batch error:", err.message);
      sendEvent({ type: "fatal", message: err.message });
      res.end();
    }
  });

  app.post("/api/geo/enriquecer-agro", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const orgId = getOrgId(req);
      const { lat, lon, codIBGE, cnpj, culturaPrincipal, fazendaId } = req.body;

      if (!lat || !lon) {
        return res.status(400).json({ error: 'lat e lon são obrigatórios' });
      }

      const resultado = await enriquecerFazenda({ lat, lon, codIBGE, cnpj, culturaPrincipal });

      if (fazendaId) {
        const [existing] = await db.select({ id: assets.id }).from(assets).where(
          sql`${assets.id} = ${fazendaId} AND ${assets.orgId} = ${orgId}`
        );
        if (existing) {
          const embrapaCompat: any = {};
          if (resultado.solo) {
            const s = resultado.solo;
            let textura = '';
            if (s.clay !== null) {
              if (s.clay > 60) textura = 'Muito argilosa';
              else if (s.clay > 35) textura = 'Argilosa';
              else if (s.clay > 15) textura = 'Média';
              else textura = 'Arenosa';
            }
            let aptidao = '';
            if (s.phh2o !== null && s.soc !== null) {
              if (s.phh2o >= 5.5 && s.phh2o <= 7.0 && s.soc > 10) aptidao = 'Boa para agricultura';
              else if (s.phh2o >= 4.5 && s.phh2o <= 7.5) aptidao = 'Moderada';
              else aptidao = 'Restrita — necessita correção';
            }
            embrapaCompat.solo = {
              classificacao: s.soilClass || 'Não classificado', textura, aptidao,
              ph: s.phh2o, argila: s.clay, areia: s.sand,
              carbonoOrganico: s.soc, nitrogenio: s.nitrogen, cec: s.cec,
              fonte: 'SoilGrids/ISRIC',
            };
          }
          if (resultado.zarc?.length > 0) {
            embrapaCompat.zoneamento = {
              culturas: resultado.zarc.map((z: any) => ({
                nome: z.cultura, risco: z.aptidao === 'Apto' ? 'baixo' : z.aptidao === 'Inapto' ? 'alto' : 'medio',
                epocaPlantio: z.datasPlantio?.join(', ') || '', aptidao: z.aptidao,
              })),
            };
          }
          if (resultado.ndviSatveg && resultado.ndviSatveg.ndviMedio > 0) {
            embrapaCompat.ndvi = {
              ndvi: resultado.ndviSatveg.ndviMedio, evi: resultado.ndviSatveg.eviMedio,
              classificacao: resultado.ndviSatveg.ndviMedio >= 0.7 ? 'Vegetação densa e saudável' : resultado.ndviSatveg.ndviMedio >= 0.4 ? 'Vegetação moderada' : 'Vegetação escassa',
              fonte: resultado.ndviSatveg.fonte,
              periodo: `${resultado.ndviSatveg.dataInicio} a ${resultado.ndviSatveg.dataFim}`,
            };
          }
          if (resultado.clima) {
            const tempMedia = resultado.clima.temperaturaMinMedia && resultado.clima.temperaturaMaxMedia
              ? parseFloat(((resultado.clima.temperaturaMinMedia + resultado.clima.temperaturaMaxMedia) / 2).toFixed(1)) : 0;
            embrapaCompat.clima = {
              precipitacaoMedia: resultado.clima.precipitacaoMedia, temperaturaMedia: tempMedia,
              temperaturaMax: resultado.clima.temperaturaMaxMedia, temperaturaMin: resultado.clima.temperaturaMinMedia,
              indiceSeca: resultado.resumo || '', fonte: resultado.clima.fonte,
              precipitacaoAnual: resultado.clima.precipitacaoAnual,
              precipitacaoMensal: resultado.clima.precipitacaoMensal,
              temperaturaMensal: resultado.clima.temperaturaMensal,
              mesesSecos: resultado.clima.mesesSecos,
              mesesChuvosos: resultado.clima.mesesChuvosos,
              anoReferencia: resultado.clima.anoReferencia,
            };
          }
          embrapaCompat.scoreAgro = resultado.scoreAgro;
          embrapaCompat.resumo = resultado.resumo;

          const enrichData = {
            embrapa: embrapaCompat,
            agro: resultado,
            embrapaUpdatedAt: new Date().toISOString(),
            agroEnriquecidoEm: new Date().toISOString(),
          };
          await db.execute(sql`
            UPDATE assets SET campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify(enrichData)}::jsonb
            WHERE id = ${fazendaId}
          `);
        }
      }

      res.json({ success: true, data: resultado });
    } catch (err: any) {
      console.error('[/enriquecer-agro]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/geo/solo", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const lat = parseFloat(req.query.lat as string);
      const lon = parseFloat(req.query.lon as string);
      if (isNaN(lat) || isNaN(lon)) {
        return res.status(400).json({ error: 'lat e lon inválidos' });
      }
      const solo = await consultarSoloSoilGrids(lat, lon);
      res.json({ success: true, data: solo });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/geo/sigef/:cnpj", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const cnpj = req.params.cnpj.replace(/\D/g, '');
      if (cnpj.length !== 14) {
        return res.status(400).json({ error: 'CNPJ inválido' });
      }
      res.json({ success: true, data: [], total: 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const sicorCache = new Map<string, { data: any; expiry: number }>();
  const SICOR_CACHE_TTL = 24 * 60 * 60 * 1000;

  app.get("/api/mavrion/sicor/:codigoMunicipio", async (req, res) => {
    try {
      const codigo = req.params.codigoMunicipio;
      const cached = sicorCache.get(codigo);
      if (cached && cached.expiry > Date.now()) return res.json(cached.data);

      const baseUrl = "https://olinda.bcb.gov.br/olinda/servico/SICOR/versao/v2/odata";
      const custeioFilter = encodeURIComponent(`codIbge eq '${codigo}'`);
      const custeioUrl = `${baseUrl}/CusteioMunicipioProduto?$format=json&$filter=${custeioFilter}&$top=50&$orderby=VlCusteio desc`;
      const pronafFilter = encodeURIComponent("contains(Programa,'PRONAF')");
      const programaUrl = `${baseUrl}/ProgramaSubprograma?$format=json&$filter=${pronafFilter}&$top=20`;

      const [custeioRes, programaRes] = await Promise.all([
        fetch(custeioUrl, { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : { value: [] }).catch(() => ({ value: [] })),
        fetch(programaUrl, { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : { value: [] }).catch(() => ({ value: [] })),
      ]);

      const custeioData = custeioRes.value || [];
      const programaData = programaRes.value || [];

      const grouped = new Map<string, { produto: string; valor: number; area: number; count: number }>();
      for (const c of custeioData) {
        const prod = c.nomeProduto || c.Atividade || "Desconhecido";
        const existing = grouped.get(prod) || { produto: prod, valor: 0, area: 0, count: 0 };
        existing.valor += Number(c.VlCusteio) || 0;
        existing.area += Number(c.AreaCusteio) || 0;
        existing.count += 1;
        grouped.set(prod, existing);
      }

      const topProdutos = [...grouped.values()]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5)
        .map(p => ({ produto: p.produto, contratos: p.count, valor: p.valor, area: p.area }));

      const totalContratos = custeioData.length;
      const totalValor = custeioData.reduce((sum: number, c: any) => sum + (Number(c.VlCusteio) || 0), 0);

      const result = {
        codigoMunicipio: codigo,
        totalContratos,
        totalValor,
        topProdutos,
        pronafResumo: programaData.slice(0, 10).map((p: any) => ({
          programa: p.Programa,
          subprograma: p.Subprograma,
          contratos: p.QtdCusteio || 0,
          valor: Number(p.VlCusteio) || 0,
        })),
        consultadoEm: new Date().toISOString(),
      };

      sicorCache.set(codigo, { data: result, expiry: Date.now() + SICOR_CACHE_TTL });
      res.json(result);
    } catch (err: any) {
      console.error("[SICOR] Erro:", err.message);
      res.status(500).json({ message: "Falha ao consultar SICOR/BCB" });
    }
  });

  app.post("/api/geo/due-diligence-fundiaria", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { codigoIncra, cpfCnpj, assetId, lat, lon, areaIncraHa, areaCarHa, codigoCar: codigoCarBody } = req.body;

      if (!codigoIncra || typeof codigoIncra !== "string") {
        return res.status(400).json({ message: "Código INCRA é obrigatório" });
      }

      let latitude = lat !== undefined && lat !== null && lat !== '' ? parseFloat(String(lat)) : null;
      let longitude = lon !== undefined && lon !== null && lon !== '' ? parseFloat(String(lon)) : null;
      let incraArea = areaIncraHa !== undefined && areaIncraHa !== null ? parseFloat(String(areaIncraHa)) : undefined;
      let carArea = areaCarHa !== undefined && areaCarHa !== null ? parseFloat(String(areaCarHa)) : undefined;
      let titularDoc = cpfCnpj || undefined;
      let codigoCar = codigoCarBody || undefined;
      let municipioIbge: string | undefined = req.body.codigoIbge || undefined;

      if (assetId) {
        const orgId = getOrgId(req);
        const [asset] = await db.select().from(assets).where(
          and(eq(assets.id, Number(assetId)), eq(assets.orgId, orgId))
        );
        if (!asset) {
          return res.status(404).json({ message: "Ativo não encontrado" });
        }

        const campos = (asset.camposEspecificos || {}) as any;
        const attr = (asset.attributesJson || {}) as any;
        if (latitude === null && campos.latitude != null) latitude = Number(campos.latitude);
        if (longitude === null && campos.longitude != null) longitude = Number(campos.longitude);
        if (incraArea === undefined && asset.areaHa) incraArea = Number(asset.areaHa);
        if (carArea === undefined && attr.carArea) carArea = Number(attr.carArea);
        if (!codigoCar) {
          codigoCar = campos.codigoCar || campos.codigoCAR || attr.codigoCar || attr.codigoCAR || undefined;
        }
        if (!titularDoc) {
          titularDoc = campos.cnpj || attr.cnpj || attr.cpfCnpj || undefined;
        }
        if (!municipioIbge) {
          municipioIbge = campos.codigoIbge || attr.codigoIbge || undefined;
        }
      }

      const hasCoords = latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude);
      if (!hasCoords && !assetId) {
        return res.status(400).json({ message: "Coordenadas (lat/lon) ou assetId com polígono são obrigatórios" });
      }

      console.log(`[Due Diligence Fundiária] Iniciando para INCRA ${codigoIncra}${hasCoords ? ` (${latitude}, ${longitude})` : ` (ativo ${assetId})`}`);

      const resultado = await executarDueDiligenceFundiaria({
        codigoIncra,
        cpfCnpj: titularDoc,
        lat: hasCoords ? latitude! : undefined,
        lon: hasCoords ? longitude! : undefined,
        areaIncraHa: incraArea,
        areaCarHa: carArea,
        codigoCar,
        codigoIbge: municipioIbge,
        assetId: assetId ? Number(assetId) : undefined,
      });

      if (assetId) {
        const orgId = getOrgId(req);
        try {
          await db.execute(sql`
            UPDATE assets SET
              campos_especificos = COALESCE(campos_especificos, '{}'::jsonb) || ${JSON.stringify({
                dueDiligenceFundiaria: resultado,
                dueDiligenceFundiariaEm: new Date().toISOString(),
              })}::jsonb
            WHERE id = ${Number(assetId)} AND org_id = ${orgId}
          `);
          console.log(`[Due Diligence Fundiária] Resultados salvos no ativo ${assetId}`);
        } catch (saveErr: any) {
          console.error(`[Due Diligence Fundiária] Erro ao salvar no ativo:`, saveErr.message);
        }
      }

      res.json(resultado);
    } catch (err: any) {
      console.error("[Due Diligence Fundiária] Erro:", err.message);
      res.status(500).json({ message: "Erro na due diligence fundiária" });
    }
  });

}
