import type { Express } from "express";
import type { IStorage } from "../storage";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { assets, sicarImoveisCache, norionCafRegistros } from "@shared/schema";
import { sql, eq, ilike, and, gte, lte } from "drizzle-orm";
import { getCached, setCached } from "../cache";
import { getOrgId } from "../lib/tenant";
import {
  enriquecerFazenda,
  consultarSoloSoilGrids,
  consultarParcelasSIGEF,
  type EnriquecimentoAgroCompleto
} from '../enrichment/agro';

const ANM_MAPSERVER_URL = "https://geo.anm.gov.br/arcgis/rest/services/SIGMINE/dados_anm/MapServer/0/query";
const SICAR_WFS = "https://geoserver.car.gov.br/geoserver/sicar/wfs";
const CAR_PUBLIC_URL = "https://consultapublica.car.gov.br/publico/imoveis/index";
const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/wfs";
const ELEVATION_API = "https://api.opentopodata.org/v1/srtm30m";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const UF_LIST = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

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
  uso: /^[A-ZÀ-Ü0-9 ,.-]{1,100}$/i,
  ano: /^[0-9]{4}$/,
  ultEvento: /^[A-ZÀ-Ü0-9 ,./()-]{2,200}$/i,
};

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

export function registerGeoRoutes(app: Express, storage: IStorage, db: NodePgDatabase<any>) {
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

      const procVal = sanitizeAnmInput(req.query.processo, ANM_PATTERNS.processo);
      if (procVal) clauses.push(`PROCESSO LIKE '%${procVal}%'`);

      const usoVal = sanitizeAnmInput(req.query.uso, ANM_PATTERNS.uso);
      if (usoVal) clauses.push(buildAccentAwareLike("USO", usoVal));

      const anoVal = sanitizeAnmInput(req.query.ano, ANM_PATTERNS.ano);
      if (anoVal) clauses.push(`ANO=${anoVal}`);

      const ultEventoVal = sanitizeAnmInput(req.query.ultEvento, ANM_PATTERNS.ultEvento);
      if (ultEventoVal) clauses.push(buildAccentAwareLike("ULT_EVENTO", ultEventoVal));

      if (clauses.length === 0) {
        return res.status(400).json({ message: "Informe ao menos um filtro de busca válido." });
      }

      const cacheKey = JSON.stringify({ uf: ufVal, substancia: subsVal, fase: faseVal, empresa: empVal, processo: procVal, uso: usoVal, ano: anoVal, ultEvento: ultEventoVal });
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

      const response = await fetch(`${ANM_MAPSERVER_URL}?${params.toString()}`);
      if (!response.ok) {
        return res.status(502).json({ message: "Falha ao consultar o geoportal ANM" });
      }

      const data = await response.json() as any;
      if (data.error) {
        return res.status(502).json({ message: data.error.message || "Erro no geoportal ANM" });
      }
      const features = (data.features || []).map((f: any) => f.attributes || f);
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

      const response = await fetch(`${ANM_MAPSERVER_URL}?${params.toString()}`);
      if (!response.ok) {
        return res.status(502).json({ message: "Falha ao consultar geometria no geoportal ANM" });
      }

      const data = await response.json() as any;
      if (data.error) {
        return res.status(502).json({ message: data.error.message || "Erro no geoportal ANM" });
      }
      const geojson = await esriToGeoJSON(data.features || []);
      res.json(geojson);
    } catch (err: any) {
      console.error("ANM geometria error:", err.message);
      res.status(500).json({ message: "Erro ao consultar geometria ANM" });
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

      try {
        const geoParams = new URLSearchParams({
          where: `PROCESSO='${processo.replace(/[^0-9/]/g, "")}'`,
          outFields: "PROCESSO",
          returnGeometry: "true",
          geometryType: "esriGeometryPolygon",
          outSR: "4326",
          f: "json",
        });
        const geoResp = await fetch(`${ANM_MAPSERVER_URL}?${geoParams.toString()}`);
        if (geoResp.ok) {
          const geoData = await geoResp.json() as any;
          const geojson = await esriToGeoJSON(geoData.features || []);
          if (geojson.features?.length > 0) {
            const [lat, lng] = centroidFromGeometry(geojson.features[0].geometry);
            if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
              latitude = Math.round(lat * 1000000) / 1000000;
              longitude = Math.round(lng * 1000000) / 1000000;

              try {
                const ibgeResp = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado&lat=${latitude}&lon=${longitude}`, { signal: AbortSignal.timeout(8000) });
                if (!ibgeResp.ok) {
                  const nomResp = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=10`, {
                    headers: { "User-Agent": "MavrionConnect/1.0" },
                    signal: AbortSignal.timeout(8000),
                  });
                  if (nomResp.ok) {
                    const nomData = await nomResp.json() as any;
                    municipio = nomData.address?.city || nomData.address?.town || nomData.address?.municipality || null;
                    const extratags = nomData.extratags || {};
                    codigoIbge = extratags["IBGE:GEOCODIGO"] || extratags["ibge:geocodigo"] || null;
                  }
                } else {
                  const ibgeData = await ibgeResp.json() as any;
                  if (Array.isArray(ibgeData) && ibgeData.length > 0) {
                    codigoIbge = String(ibgeData[0].id || ibgeData[0]["municipio-id"] || "");
                    municipio = ibgeData[0].nome || ibgeData[0]["municipio-nome"] || null;
                  }
                }
              } catch {}
            }
          }
        }
      } catch (geoErr: any) {
        console.error("ANM geo lookup (non-fatal):", geoErr.message);
      }

      const asset = await storage.createAsset({
        orgId: getOrgId(),
        type: "MINA",
        title: `${substancia || "Processo"} - ${processo}`,
        description: `Processo minerário ANM: ${processo}\nTitular: ${nome || "N/A"}\nFase: ${fase || "N/A"}\nSubstância: ${substancia || "N/A"}\nUso: ${uso || "N/A"}\nÚltimo Evento: ${ultEvento || "N/A"}`,
        location: municipio ? `${municipio}/${uf || ""}` : (uf || null),
        estado: uf || null,
        areaHa: bodyArea ? Number(bodyArea) : null,
        tags: ["ANM", "Importado"],
        anmProcesso: processo,
        linkedCompanyId,
        camposEspecificos: {
          latitude,
          longitude,
          codigoIbge,
          municipio,
        },
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

      res.status(201).json(asset);
    } catch (err: any) {
      console.error("ANM import asset error:", err.message);
      res.status(500).json({ message: "Erro ao importar processo como ativo" });
    }
  });

  app.get("/api/geo/sicar-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const testUrl = `${SICAR_WFS}?service=WFS&version=2.0.0&request=GetCapabilities`;
      const response = await fetch(testUrl, {
        signal: controller.signal,
        method: "GET",
      }).catch(() => null);

      clearTimeout(timeout);

      const online = response?.ok || response?.status === 400;
      res.json({
        online,
        checkedAt: new Date().toISOString(),
        portalUrl: CAR_PUBLIC_URL,
      });
    } catch {
      res.json({
        online: false,
        checkedAt: new Date().toISOString(),
        portalUrl: CAR_PUBLIC_URL,
      });
    }
  });

  app.get("/api/geo/fazendas", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { uf, municipio, areaMin, areaMax } = req.query;
      if (!uf || !UF_LIST.includes(String(uf).toUpperCase())) {
        return res.status(400).json({ message: "UF obrigatório e válido" });
      }
      const ufLower = String(uf).toLowerCase();
      const count = Math.min(Number(req.query.count) || 30, 50);
      const startIndex = Number(req.query.startIndex) || 0;

      let cqlParts: string[] = [];
      if (municipio) {
        const m = String(municipio).replace(/[^a-zA-ZÀ-ÿ\s]/g, "").toUpperCase();
        cqlParts.push(`municipio LIKE '%${m}%'`);
      }
      if (areaMin) cqlParts.push(`num_area >= ${parseFloat(String(areaMin))}`);
      if (areaMax) cqlParts.push(`num_area <= ${parseFloat(String(areaMax))}`);

      const sicarCacheKey = JSON.stringify({ uf: ufLower, municipio, areaMin, areaMax, count, startIndex });
      const sicarCached = await getCached<any>("sicar", sicarCacheKey);
      if (sicarCached) {
        return res.json(sicarCached);
      }

      const params = new URLSearchParams({
        service: "WFS",
        version: "2.0.0",
        request: "GetFeature",
        typeName: `sicar:sicar_imoveis_${ufLower}`,
        outputFormat: "application/json",
        count: String(count),
        startIndex: String(startIndex),
        srsName: "EPSG:4326",
      });
      if (cqlParts.length > 0) {
        params.set("CQL_FILTER", cqlParts.join(" AND "));
      }

      const url = `${SICAR_WFS}?${params.toString()}`;

      let lastError = "";
      let sicarData: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
          if (response.ok) {
            sicarData = await response.json();
            break;
          }
          lastError = `SICAR WFS HTTP ${response.status}`;
          if (response.status === 400) {
            const paramsFallback = new URLSearchParams({
              service: "WFS",
              version: "1.1.0",
              request: "GetFeature",
              typeName: `sicar:sicar_imoveis_${ufLower}`,
              outputFormat: "application/json",
              maxFeatures: String(count),
              startIndex: String(startIndex),
              srsName: "EPSG:4326",
            });
            if (cqlParts.length > 0) {
              paramsFallback.set("CQL_FILTER", cqlParts.join(" AND "));
            }
            const fallbackUrl = `${SICAR_WFS}?${paramsFallback.toString()}`;
            const fallbackResp = await fetch(fallbackUrl, { signal: AbortSignal.timeout(30000) });
            if (fallbackResp.ok) {
              sicarData = await fallbackResp.json();
              break;
            }
            lastError = `SICAR WFS fallback HTTP ${fallbackResp.status}`;
          }
        } catch (fetchErr: any) {
          lastError = fetchErr.message || "timeout";
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }

      if (sicarData) {
        await setCached("sicar", sicarCacheKey, sicarData);

        setImmediate(async () => {
          try {
            const features = sicarData?.features || [];
            for (const feat of features) {
              const p = feat.properties || {};
              const codIm = p.cod_imovel || p.COD_IMOVEL;
              if (!codIm) continue;
              await db.execute(sql`
                INSERT INTO sicar_imoveis_cache (cod_imovel, uf, municipio, num_area, ind_status, ind_tipo, geometry, properties, fetched_at)
                VALUES (${codIm}, ${ufLower.toUpperCase()}, ${p.municipio || p.nom_municipio || null}, ${p.num_area ? parseFloat(String(p.num_area)) : null}, ${p.ind_status || null}, ${p.ind_tipo || null}, ${JSON.stringify(feat.geometry || null)}::jsonb, ${JSON.stringify(p)}::jsonb, NOW())
                ON CONFLICT (cod_imovel) DO UPDATE SET
                  geometry = EXCLUDED.geometry,
                  properties = EXCLUDED.properties,
                  num_area = EXCLUDED.num_area,
                  ind_status = EXCLUDED.ind_status,
                  ind_tipo = EXCLUDED.ind_tipo,
                  fetched_at = NOW()
              `);
            }
            console.log(`[SICAR Cache] Persistidos ${features.length} imóveis para ${ufLower.toUpperCase()}`);
          } catch (cacheErr) {
            console.error("[SICAR Cache] Erro ao persistir:", cacheErr);
          }
        });

        return res.json(sicarData);
      }

      const conditions: any[] = [eq(sicarImoveisCache.uf, ufLower.toUpperCase())];
      if (municipio) {
        conditions.push(ilike(sicarImoveisCache.municipio, `%${String(municipio).replace(/[^a-zA-ZÀ-ÿ\s]/g, "").toUpperCase()}%`));
      }
      if (areaMin) conditions.push(gte(sicarImoveisCache.numArea, parseFloat(String(areaMin))));
      if (areaMax) conditions.push(lte(sicarImoveisCache.numArea, parseFloat(String(areaMax))));

      const whereClause = and(...conditions);
      const [cachedRows, countResult] = await Promise.all([
        db.select().from(sicarImoveisCache).where(whereClause).limit(count).offset(startIndex),
        db.select({ total: sql<number>`count(*)::int` }).from(sicarImoveisCache).where(whereClause),
      ]);

      if (cachedRows.length > 0) {
        const totalCached = (countResult[0] as any)?.total || cachedRows.length;
        const cachedAt = cachedRows[0].fetchedAt ? new Date(cachedRows[0].fetchedAt).toISOString() : null;
        const featureCollection = {
          type: "FeatureCollection",
          features: cachedRows.map(row => ({
            type: "Feature",
            geometry: row.geometry,
            properties: { ...(row.properties as any || {}), cod_imovel: row.codImovel, municipio: row.municipio, num_area: row.numArea, ind_status: row.indStatus, ind_tipo: row.indTipo },
          })),
          totalFeatures: totalCached,
          fromCache: true,
          cachedAt,
        };
        return res.json(featureCollection);
      }

      res.status(502).json({
        message: "SICAR indisponível",
        detail: "O servidor do SICAR (geoserver.car.gov.br) está fora do ar no momento. Não há dados em cache para esta consulta.",
        portalUrl: CAR_PUBLIC_URL,
        sicarOffline: true,
      });
    } catch (err: any) {
      console.error("Geo fazendas error:", err.message);
      res.status(502).json({
        message: "SICAR indisponível",
        detail: "O servidor do SICAR (geoserver.car.gov.br) está fora do ar no momento. Use a busca manual por código CAR ou acesse o portal público.",
        portalUrl: CAR_PUBLIC_URL,
        sicarOffline: true,
      });
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
      const result = await db.select({ id: assets.id, carCodImovel: sql<string>`car_cod_imovel` })
        .from(assets)
        .where(sql`car_cod_imovel IS NOT NULL`);
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

      const props = feature.properties;
      const codImovel = props.cod_imovel || props.COD_IMOVEL || props.cod_car || "";

      if (codImovel) {
        const existing = await db.select({ id: assets.id })
          .from(assets)
          .where(sql`car_cod_imovel = ${codImovel}`)
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
      if (analysis?.centroide) {
        centroidLat = analysis.centroide.lat || analysis.centroide[1] || centroidLat;
        centroidLon = analysis.centroide.lon || analysis.centroide[0] || centroidLon;
      }

      const codMunicipio = props.cod_municipio || props.COD_MUNICIPIO || props.cod_ibge || "";

      const asset = await storage.createAsset({
        orgId: getOrgId(),
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
        },
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
              };
            }
            embrapaCompat.scoreAgro = resultado.scoreAgro;
            embrapaCompat.resumo = resultado.resumo;

            const currentAsset = await storage.getAsset(asset.id);
            const currentCampos = (currentAsset?.camposEspecificos as any) || {};
            await storage.updateAsset(asset.id, {
              camposEspecificos: {
                ...currentCampos,
                embrapa: embrapaCompat,
                enrichmentAgro: resultado,
                embrapaUpdatedAt: new Date().toISOString(),
              },
            });
            console.log(`[Auto-enrich] Ativo ${asset.id} enriquecido com sucesso. Score agro: ${resultado.scoreAgro}`);
          } catch (enrichErr: any) {
            console.warn(`[Auto-enrich] Falha no enriquecimento do ativo ${asset.id}:`, enrichErr.message);
          }
        })();
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
                    .select({ id: norionCafRegistros.id })
                    .from(norionCafRegistros)
                    .where(and(eq(norionCafRegistros.orgId, orgIdVal), eq(norionCafRegistros.numeroUFPA, lead.nufpa)))
                    .limit(1);
                  if (!existente) {
                    await db.insert(norionCafRegistros).values({
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
                      norionProfile: lead.norionProfile || "baixo",
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

  app.post("/api/geo/persist-analysis", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Não autenticado" });
    try {
      const { assetId, analysis } = req.body;
      if (!assetId || !analysis) return res.status(400).json({ message: "assetId e analysis obrigatórios" });

      const [existing] = await db.select({ id: assets.id, areaHa: assets.areaHa, orgId: assets.orgId, camposEspecificos: assets.camposEspecificos, municipio: assets.municipio, estado: assets.estado })
        .from(assets).where(sql`id = ${assetId}`).limit(1);
      if (!existing || existing.orgId !== getOrgId()) return res.status(404).json({ message: "Ativo não encontrado" });

      if (!existing.areaHa) {
        try {
          const [areaRow] = await db.execute(sql`SELECT ROUND(CAST(ST_Area(ST_Transform(geom, 32723)) / 10000 AS numeric), 2) as calc_area FROM assets WHERE id = ${assetId} AND geom IS NOT NULL`);
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
      const ce = (existing.camposEspecificos || {}) as any;
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
      const orgId = getOrgId();
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
      const orgId = getOrgId();
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
    try {
      const orgId = getOrgId(req);
      const { lat, lon, codIBGE, cnpj, culturaPrincipal, fazendaId } = req.body;

      if (!lat || !lon) {
        return res.status(400).json({ error: 'lat e lon são obrigatórios' });
      }

      const resultado = await enriquecerFazenda({ lat, lon, codIBGE, cnpj, culturaPrincipal });

      if (fazendaId) {
        const [existing] = await db.select().from(assets).where(
          sql`${assets.id} = ${fazendaId} AND ${assets.orgId} = ${orgId}`
        );
        if (existing) {
          const currentData = (existing.enrichmentData as any) || {};
          await db.update(assets).set({
            enrichmentData: { ...currentData, agro: resultado, agroEnriquecidoEm: new Date().toISOString() },
          }).where(sql`${assets.id} = ${fazendaId}`);
        }
      }

      res.json({ success: true, data: resultado });
    } catch (err: any) {
      console.error('[/enriquecer-agro]', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/geo/solo", async (req, res) => {
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
    try {
      getOrgId(req);
      const cnpj = req.params.cnpj.replace(/\D/g, '');
      if (cnpj.length !== 14) {
        return res.status(400).json({ error: 'CNPJ inválido' });
      }
      const parcelas = await consultarParcelasSIGEF(cnpj);
      res.json({ success: true, data: parcelas, total: parcelas.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const sicorCache = new Map<string, { data: any; expiry: number }>();
  const SICOR_CACHE_TTL = 24 * 60 * 60 * 1000;

  app.get("/api/norion/sicor/:codigoMunicipio", async (req, res) => {
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
}
