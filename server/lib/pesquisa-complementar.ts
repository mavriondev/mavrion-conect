/**
 * Pesquisa complementar da jazida — fontes públicas gratuitas que complementam
 * (não substituem) os módulos já existentes do dossiê e a Hub API Mavrion.
 *
 * Divisão por fonte:
 * - Hub API (bases sincronizadas e compartilhadas): processos SIGMINE vizinhos,
 *   bacias sedimentares e geocronologia do SGB.
 * - Connect (consulta pontual/documental): RIGeo (repositório do SGB),
 *   afloramentos e litoestratigrafia de detalhe do GeoSGB, recursos hídricos
 *   da ANA/SNIRH.
 *
 * Contrato: cada fonte devolve estado explícito — "registro", "sem_registro"
 * ou "indisponivel" (com motivo). Falha de fonte nunca é tratada como ausência
 * de registro. Resultados são cortados por limites fixos (volume) e tempo.
 * Proximidade de água, energia ou acesso NÃO comprova disponibilidade, outorga,
 * conexão ou acesso legal — os textos de cobertura dizem isso explicitamente.
 */
import { getCached, setCached } from "../cache";
import { hubApiGet } from "./hub-api";
import { casaSubstancia, classificarSubstancia, type SubstanciaClassificada } from "./jazida-perfis";

export type EstadoFonte = "registro" | "sem_registro" | "indisponivel";
export type VinculoEspacial = "poligono" | "entorno" | "regional" | "documento";

export interface FonteResultado {
  id: FonteId;
  label: string;
  fonte: string;
  atribuicao: string;
  vinculo: VinculoEspacial;
  estado: EstadoFonte;
  motivo?: string;
  consultadoEm: string;
  raioKm?: number;
  total?: number;
  truncado?: boolean;
  cobertura: string;
  data?: any;
  /** Quando a consulta atual falhou mas havia resultado anterior preservado. */
  atualizacaoFalhou?: { em: string; motivo: string };
}

export type FonteId =
  | "rigeo"
  | "processosVizinhos"
  | "sgbContexto"
  | "afloramentos"
  | "litoDetalhada"
  | "recursosHidricos";

export const FONTES_COMPLEMENTARES: Array<{ id: FonteId; label: string; origem: "hub" | "connect" }> = [
  { id: "processosVizinhos", label: "Processos ANM vizinhos (SIGMINE espelhado)", origem: "hub" },
  { id: "sgbContexto", label: "Bacias sedimentares e geocronologia (SGB via Hub)", origem: "hub" },
  { id: "litoDetalhada", label: "Litoestratigrafia de detalhe (GeoSGB 1:250k/1:100k)", origem: "connect" },
  { id: "afloramentos", label: "Afloramentos descritos (GeoSGB)", origem: "connect" },
  { id: "recursosHidricos", label: "Recursos hídricos (ANA/SNIRH)", origem: "connect" },
  { id: "rigeo", label: "Documentos técnicos (RIGeo/SGB)", origem: "connect" },
];

export interface ParametrosPesquisa {
  lat: number;
  lon: number;
  substancia: string;
  uf?: string | null;
  municipio?: string | null;
  processoAnm?: string | null;
  raioKm?: number;
  refresh?: boolean;
  fontes?: FonteId[];
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const agora = () => new Date().toISOString();

const UF_NOMES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bboxFromRadius(lat: number, lon: number, raioKm: number): [number, number, number, number] {
  const dLat = raioKm / 111.32;
  const dLon = raioKm / (111.32 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Distância mínima (km) de um ponto a uma polilinha [[lon,lat],...]. */
function minDistToLineKm(lat: number, lon: number, line: number[][]): number | null {
  let best: number | null = null;
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = haversineKm(lat, lon, y, x);
    if (best == null || d < best) best = d;
  }
  return best;
}

function centroid(geometry: any): { lat: number; lon: number } | null {
  let ring: number[][] | null = null;
  if (geometry?.type === "Polygon") ring = geometry.coordinates?.[0];
  else if (geometry?.type === "MultiPolygon") ring = geometry.coordinates?.[0]?.[0];
  else if (geometry?.type === "Point") return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
  if (!ring || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) { if (Number.isFinite(x) && Number.isFinite(y)) { sx += x; sy += y; n++; } }
  return n ? { lon: sx / n, lat: sy / n } : null;
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

export function pointInGeom(pt: [number, number], geom: any): boolean {
  if (!geom) return false;
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates || [];
    if (!outer || !pointInRing(pt, outer)) return false;
    return !holes.some((h: number[][]) => pointInRing(pt, h));
  }
  if (geom.type === "MultiPolygon") return (geom.coordinates || []).some((poly: number[][][]) => pointInGeom(pt, { type: "Polygon", coordinates: poly }));
  return false;
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ ok: true; data: any } | { ok: false; motivo: string }> {
  const { timeoutMs = 25000, ...rest } = init;
  try {
    const resp = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": "MavrionConnect/1.0 (+pesquisa-complementar)", ...(rest.headers || {}) } });
    if (!resp.ok) return { ok: false, motivo: `HTTP ${resp.status}` };
    const data = await resp.json();
    if (data?.error) return { ok: false, motivo: data.error.message || `erro ${data.error.code || ""}`.trim() };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, motivo: e?.name === "TimeoutError" || e?.name === "AbortError" ? `tempo esgotado (${Math.round(timeoutMs / 1000)} s)` : (e?.message || "erro de rede") };
  }
}

async function arcgisQuery(url: string, params: Record<string, string>, timeoutMs = 30000) {
  const body = new URLSearchParams({ f: "json", ...params });
  return fetchJson(`${url}/query`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), timeoutMs });
}

const indisponivel = (base: Omit<FonteResultado, "estado" | "consultadoEm" | "motivo">, motivo: string): FonteResultado =>
  ({ ...base, estado: "indisponivel", motivo, consultadoEm: agora() });

// ── Fontes ───────────────────────────────────────────────────────────────────

async function fonteRigeo(p: ParametrosPesquisa, classe: SubstanciaClassificada): Promise<FonteResultado> {
  const base = {
    id: "rigeo" as const,
    label: "Documentos técnicos (RIGeo/SGB)",
    fonte: "RIGeo — Repositório Institucional de Geociências (SGB/CPRM)",
    atribuicao: "SGB/CPRM — acesso público; citar título, autor e ano",
    vinculo: "documento" as const,
    cobertura: "Busca textual por substância e local (título/assunto/resumo). O casamento é documental, não espacial: documento regional não comprova dado no polígono. Conteúdo não foi lido nem verificado — só o registro bibliográfico.",
  };
  if (!classe.termos.length) return { ...base, estado: "sem_registro", motivo: "substância não informada — busca documental não executada", consultadoEm: agora(), total: 0, data: { documentos: [], consultas: [] } };
  const termoPrincipal = classe.termos[0];
  const ufNome = p.uf ? UF_NOMES[p.uf.toUpperCase()] || p.uf : null;
  const consultas = Array.from(new Set([
    p.municipio ? `${termoPrincipal} ${p.municipio}` : null,
    ufNome ? `${termoPrincipal} ${ufNome}` : null,
    !p.municipio && !ufNome ? termoPrincipal : null,
  ].filter(Boolean) as string[]));
  const vistos = new Map<string, any>();
  const falhas: string[] = [];
  for (const q of consultas) {
    const r = await fetchJson(`https://rigeo.sgb.gov.br/server/api/discover/search/objects?query=${encodeURIComponent(q)}&size=15`, { timeoutMs: 25000 });
    if (!r.ok) { falhas.push(`${q}: ${r.motivo}`); continue; }
    const objetos: any[] = r.data?._embedded?.searchResult?._embedded?.objects || [];
    for (const o of objetos) {
      const it = o?._embedded?.indexableObject;
      if (!it?.uuid || vistos.has(it.uuid)) continue;
      const md = it.metadata || {};
      const v = (k: string) => (Array.isArray(md[k]) ? md[k].map((x: any) => x.value).filter(Boolean) : []);
      const assuntos = v("dc.subject").slice(0, 8);
      vistos.set(it.uuid, {
        uuid: it.uuid,
        titulo: v("dc.title")[0] || "(sem título)",
        ano: v("dc.date.issued")[0] || null,
        tipo: v("dc.type")[0] || null,
        autores: [...v("dc.contributor.author"), ...v("dc.contributor.other")].slice(0, 4),
        editor: v("dc.publisher")[0] || null,
        local: v("dc.local")[0] || null,
        assuntos,
        url: v("dc.identifier.uri")[0] || (it.handle ? `https://rigeo.sgb.gov.br/handle/${it.handle}` : null),
        consulta: q,
        casaSubstancia: casaSubstancia(`${v("dc.title")[0] || ""} ${assuntos.join(" ")}`, classe),
      });
    }
  }
  if (vistos.size === 0 && falhas.length === consultas.length) return indisponivel(base, falhas.join("; "));
  const documentos = Array.from(vistos.values())
    .sort((a, b) => Number(b.casaSubstancia) - Number(a.casaSubstancia) || String(b.ano || "").localeCompare(String(a.ano || "")) || a.titulo.localeCompare(b.titulo))
    .slice(0, 20);
  return {
    ...base,
    estado: documentos.length ? "registro" : "sem_registro",
    consultadoEm: agora(),
    total: documentos.length,
    truncado: vistos.size > 20,
    ...(falhas.length ? { motivo: `consulta(s) parcialmente indisponível(is): ${falhas.join("; ")}` } : {}),
    data: { consultas, documentos },
  };
}

async function fonteProcessosVizinhos(p: ParametrosPesquisa, classe: SubstanciaClassificada): Promise<FonteResultado> {
  const raioKm = p.raioKm || 25;
  const base = {
    id: "processosVizinhos" as const,
    label: "Processos ANM vizinhos (SIGMINE espelhado)",
    fonte: "SIGMINE/ANM — espelho semanal na Hub API Mavrion",
    atribuicao: "ANM — dados abertos",
    vinculo: "entorno" as const,
    raioKm,
    cobertura: `Processos minerários com geometria num quadrado de ±${raioKm} km em torno do ponto de referência; distância medida ao centroide de cada polígono. Requerimento vizinho indica interesse exploratório, não mineralização.`,
  };
  const [x1, y1, x2, y2] = bboxFromRadius(p.lat, p.lon, raioKm);
  const bbox = `${x1.toFixed(4)},${y1.toFixed(4)},${x2.toFixed(4)},${y2.toFixed(4)}`;
  const LIMITE = 300;
  const r = await hubApiGet<any>(`/api/anm/geojson?bbox=${bbox}&limit=${LIMITE}`, 30000);
  if (!r.ok) return indisponivel(base, r.motivo);
  const features: any[] = Array.isArray(r.data?.features) ? r.data.features : [];
  const proprio = String(p.processoAnm || "").replace(/\D/g, "");
  const porFase: Record<string, number> = {};
  const porSubstancia: Record<string, number> = {};
  const processos: any[] = [];
  let sobrepostos = 0;
  for (const f of features) {
    const pr = f.properties || {};
    const numero = String(pr.processo || pr.ds_processo || "").replace(/\D/g, "");
    if (proprio && numero && numero === proprio) continue;
    const c = centroid(f.geometry);
    const dist = c ? haversineKm(p.lat, p.lon, c.lat, c.lon) : null;
    const contemPonto = pointInGeom([p.lon, p.lat], f.geometry);
    if (contemPonto) sobrepostos++;
    const fase = String(pr.fase || "").trim() || "N/I";
    const subs = pr.substancia || pr.subs || "N/I";
    porFase[fase] = (porFase[fase] || 0) + 1;
    porSubstancia[subs] = (porSubstancia[subs] || 0) + 1;
    processos.push({
      processo: pr.ds_processo || pr.processo,
      titular: pr.titular || pr.nome || null,
      fase, substancia: subs, uso: pr.uso || null,
      areaHa: pr.area_ha ?? null, uf: pr.uf || null,
      ultimoEvento: pr.ult_evento || null,
      distanciaKm: dist != null ? round1(dist) : null,
      contemPontoReferencia: contemPonto,
      mesmaSubstancia: casaSubstancia(subs, classe),
    });
  }
  processos.sort((a, b) => Number(b.contemPontoReferencia) - Number(a.contemPontoReferencia) || Number(b.mesmaSubstancia) - Number(a.mesmaSubstancia) || (a.distanciaKm ?? 999) - (b.distanciaKm ?? 999) || String(a.processo).localeCompare(String(b.processo)));
  const mesmaSubstancia = processos.filter((x) => x.mesmaSubstancia);
  const topSubstancias = Object.entries(porSubstancia).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([substancia, total]) => ({ substancia, total }));
  return {
    ...base,
    estado: processos.length ? "registro" : "sem_registro",
    consultadoEm: agora(),
    total: processos.length,
    truncado: features.length >= LIMITE,
    data: {
      totalMesmaSubstancia: mesmaSubstancia.length,
      sobrepostosAoPonto: sobrepostos,
      porFase,
      topSubstancias,
      processos: processos.slice(0, 40),
    },
  };
}

async function fonteSgbContexto(p: ParametrosPesquisa): Promise<FonteResultado> {
  const raioKm = 50;
  const base = {
    id: "sgbContexto" as const,
    label: "Bacias sedimentares e geocronologia (SGB via Hub)",
    fonte: "SGB/CPRM — bacias sedimentares e geocronologia (base sincronizada na Hub API)",
    atribuicao: "SGB/CPRM — GeoSGB",
    vinculo: "regional" as const,
    raioKm,
    cobertura: `Bacia sedimentar no ponto de referência e datações geocronológicas num raio de ${raioKm} km. Idade de rocha é contexto regional — não indica mineralização no polígono.`,
  };
  const r = await hubApiGet<any>(`/api/sgb/consulta-completa?lat=${p.lat}&lon=${p.lon}&raio=${raioKm}`, 25000);
  if (!r.ok) return indisponivel(base, r.motivo);
  const bacias = (r.data?.bacias_sedimentares?.data || []).map((b: any) => ({ nome: b.nome_bacia, tipo: b.tipo }));
  const geocron = (r.data?.geocronologia_proxima?.data || []).map((g: any) => ({
    amostra: g.amostra, rocha: g.rocha, metodos: g.metodos, materiais: g.materiais_analisados,
    distanciaKm: g.distancia_km != null ? Number(g.distancia_km) : null,
  })).sort((a: any, b: any) => (a.distanciaKm ?? 999) - (b.distanciaKm ?? 999));
  const total = bacias.length + geocron.length;
  return { ...base, estado: total ? "registro" : "sem_registro", consultadoEm: agora(), total, data: { bacias, geocronologia: geocron.slice(0, 15) } };
}

async function fonteAfloramentos(p: ParametrosPesquisa): Promise<FonteResultado> {
  const raioKm = 10;
  const base = {
    id: "afloramentos" as const,
    label: "Afloramentos descritos (GeoSGB)",
    fonte: "GeoSGB/SGB-CPRM — afloramentos (banco AFLORA)",
    atribuicao: "SGB/CPRM — GeoSGB",
    vinculo: "entorno" as const,
    raioKm,
    cobertura: `Pontos de afloramento descritos por geólogos do SGB num raio de ${raioKm} km, com litologia observada. Descrição de campo, sem análise química.`,
  };
  const r = await arcgisQuery("https://geoportal.sgb.gov.br/server/rest/services/geologia/afloramentos/MapServer/0", {
    geometry: `${p.lon},${p.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(raioKm * 1000), units: "esriSRUnit_Meter",
    outFields: "ID_AFLORAMENTO,TOPONIMIA,MUNICIPIO,UF,TIPO_AFLORAMENTO,ROCHAS,PROJETO,FOLHA,NUMERO_CAMPO,DESCRICAO,DATA_CADASTRO,X,Y",
    returnGeometry: "false",
  }, 35000);
  if (!r.ok) return indisponivel(base, r.motivo);
  const feats: any[] = Array.isArray(r.data?.features) ? r.data.features : [];
  const porRocha: Record<string, number> = {};
  const pontos = feats.map((f) => {
    const a = f.attributes || {};
    const flat = Number(a.Y), flon = Number(a.X);
    const d = Number.isFinite(flat) && Number.isFinite(flon) ? haversineKm(p.lat, p.lon, flat, flon) : null;
    const rochas = a.ROCHAS || null;
    if (rochas) porRocha[rochas] = (porRocha[rochas] || 0) + 1;
    return {
      id: a.ID_AFLORAMENTO, toponimia: a.TOPONIMIA || null, municipio: a.MUNICIPIO || null, uf: a.UF || null,
      tipo: a.TIPO_AFLORAMENTO || null, rochas, projeto: a.PROJETO || null, folha: a.FOLHA || null,
      numeroCampo: a.NUMERO_CAMPO || null, descricao: a.DESCRICAO ? String(a.DESCRICAO).slice(0, 240) : null,
      dataCadastro: a.DATA_CADASTRO ? new Date(Number(a.DATA_CADASTRO)).toISOString().slice(0, 10) : null,
      lat: Number.isFinite(flat) ? flat : null, lon: Number.isFinite(flon) ? flon : null,
      distanciaKm: d != null ? round1(d) : null,
    };
  }).sort((a, b) => (a.distanciaKm ?? 999) - (b.distanciaKm ?? 999) || String(a.id).localeCompare(String(b.id)));
  const topRochas = Object.entries(porRocha).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([rocha, total]) => ({ rocha, total }));
  return { ...base, estado: pontos.length ? "registro" : "sem_registro", consultadoEm: agora(), total: pontos.length, truncado: pontos.length > 40, data: { topRochas, pontos: pontos.slice(0, 40) } };
}

async function fonteLitoDetalhada(p: ParametrosPesquisa): Promise<FonteResultado> {
  const base = {
    id: "litoDetalhada" as const,
    label: "Litoestratigrafia de detalhe (GeoSGB 1:250k/1:100k)",
    fonte: "GeoSGB/SGB-CPRM — litoestratigrafia 1:250.000 e 1:100.000",
    atribuicao: "SGB/CPRM — GeoSGB",
    vinculo: "poligono" as const,
    cobertura: "Unidade geológica mapeada no ponto de referência do ativo, nas escalas de detalhe disponíveis. Cobertura é parcial no território: ausência de unidade significa 'não mapeado nesta escala', não ausência de geologia.",
  };
  const escalas = [{ id: "250000", servico: "litoestratigrafia_250000" }, { id: "100000", servico: "litoestratigrafia_100000" }];
  const resultados: any[] = [];
  const falhas: string[] = [];
  await Promise.all(escalas.map(async (e) => {
    const r = await arcgisQuery(`https://geoportal.sgb.gov.br/server/rest/services/geologia/${e.servico}/MapServer/0`, {
      geometry: `${p.lon},${p.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "*", returnGeometry: "false",
    }, 30000);
    if (!r.ok) { falhas.push(`1:${e.id}: ${r.motivo}`); return; }
    for (const f of (r.data?.features || [])) {
      const a = f.attributes || {};
      const pick = (...ks: string[]) => { for (const k of ks) { const v = a[k] ?? a[k.toLowerCase()] ?? a[k.toUpperCase()]; if (v != null && String(v).trim() !== "") return String(v); } return null; };
      resultados.push({
        escala: `1:${e.id}`,
        sigla: pick("SIGLA", "SIGLA_UNID"), nome: pick("NOME", "NOME_UNIDA", "UNIDADE", "NOME_UNIDADE"),
        hierarquia: pick("HIERARQUIA"), litotipos: pick("LITOTIPOS", "LITOLOGIA", "LITOTIPO"),
        idade: pick("RANGE", "IDADE", "ERA_MAX", "IDADE_MAX"), ambiente: pick("AMBIENTE_TECTONICO", "AMBIENTE"),
        projeto: pick("PROJETO", "FOLHA", "NOME_FOLHA"),
      });
    }
  }));
  if (resultados.length === 0 && falhas.length === escalas.length) return indisponivel(base, falhas.join("; "));
  resultados.sort((a, b) => a.escala.localeCompare(b.escala) || String(a.sigla).localeCompare(String(b.sigla)));
  return {
    ...base,
    estado: resultados.length ? "registro" : "sem_registro",
    consultadoEm: agora(),
    total: resultados.length,
    ...(falhas.length ? { motivo: `escala(s) indisponível(is): ${falhas.join("; ")}` } : resultados.length ? {} : { motivo: "ponto não coberto por mapeamento 1:250.000/1:100.000 publicado no GeoSGB" }),
    data: { unidades: resultados },
  };
}

async function fonteRecursosHidricos(p: ParametrosPesquisa): Promise<FonteResultado> {
  const base = {
    id: "recursosHidricos" as const,
    label: "Recursos hídricos (ANA/SNIRH)",
    fonte: "ANA/SNIRH — cursos d'água (dominialidade), estações hidrometeorológicas e outorgas federais",
    atribuicao: "ANA — dados abertos SNIRH",
    vinculo: "entorno" as const,
    raioKm: 25,
    cobertura: "Cursos d'água em 5 km (com dominialidade e órgão gestor da outorga), estações hidrometeorológicas em 25 km (séries disponíveis no HidroWeb) e outorgas federais em 25 km. Água próxima NÃO comprova disponibilidade hídrica nem outorga; outorgas estaduais não estão nesta camada.",
  };
  const ANA = "https://www.snirh.gov.br/arcgis/rest/services";
  const [cursos, estacoes, outorgas] = await Promise.all([
    arcgisQuery(`${ANA}/SNIRH2016/Cursos_Agua_dominialidade/MapServer/0`, {
      geometry: `${p.lon},${p.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      distance: "5000", units: "esriSRUnit_Meter", outFields: "NORIOCOMP,DEDOMINIAL,ORGAO_GEST,NUAREAMONT",
      returnGeometry: "true", outSR: "4326", maxAllowableOffset: "0.0005",
    }, 35000),
    arcgisQuery(`${ANA}/Hidroweb_BH/INVENTARIOS_ESTACOES/MapServer/0`, {
      geometry: `${p.lon},${p.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      distance: "25000", units: "esriSRUnit_Meter",
      outFields: "EST_NM,EST_TP,RIO_NM,ORG_SG_RESPONSAVEL,ORG_SG_OPERADOR,OPERANDO,POSSUI_DADOS,ARD_VR,MUN_NM,UFD_SG,EST_CD_PLU,EST_CD_FLU,TP_ESTACAOQUALAGUA,TP_ESTACAOSEDIMENTOS",
      returnGeometry: "true", outSR: "4326",
    }, 35000),
    arcgisQuery(`${ANA}/SRE/OutorgasFederais_FeatureLayer/MapServer/0`, {
      geometry: `${p.lon},${p.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      distance: "25000", units: "esriSRUnit_Meter",
      outFields: "NUMERO_PROCESSO,NOME_DO_REQUERENTE,MUNICIPIO,UF,CORPO_HIDRICO,FINALIDADE_PRINCIPAL,TIPO_INTERFERENCIA,DATA_DE_PUBLICACAO,DATA_DE_VENCIMENTO,VOLUME_ANUAL_M3,NOME_EMPREENDIMENTO",
      returnGeometry: "true", outSR: "4326",
    }, 35000),
  ]);
  const sub = (r: any, raioKm: number, mapper: (f: any) => any, limite: number) => {
    if (!r.ok) return { estado: "indisponivel" as EstadoFonte, motivo: r.motivo, raioKm, total: 0, itens: [] as any[] };
    const feats: any[] = Array.isArray(r.data?.features) ? r.data.features : [];
    const itens = feats.map(mapper).sort((a: any, b: any) => (a.distanciaKm ?? 999) - (b.distanciaKm ?? 999) || String(a.nome || "").localeCompare(String(b.nome || "")));
    return { estado: (itens.length ? "registro" : "sem_registro") as EstadoFonte, raioKm, total: itens.length, truncado: itens.length > limite, itens: itens.slice(0, limite) };
  };
  const cursosR = sub(cursos, 5, (f) => {
    const a = f.attributes || {};
    const paths: number[][][] = f.geometry?.paths || [];
    let d: number | null = null;
    for (const line of paths) { const m = minDistToLineKm(p.lat, p.lon, line); if (m != null && (d == null || m < d)) d = m; }
    return { nome: a.NORIOCOMP || "curso d'água sem nome", dominialidade: a.DEDOMINIAL || null, orgaoGestor: a.ORGAO_GEST || null, areaMontanteKm2: a.NUAREAMONT ?? null, distanciaKm: d != null ? round1(d) : null };
  }, 10);
  const estacoesR = sub(estacoes, 25, (f) => {
    const a = f.attributes || {}; const g = f.geometry || {};
    const d = g.x != null && g.y != null ? haversineKm(p.lat, p.lon, g.y, g.x) : null;
    return {
      nome: a.EST_NM || null, tipo: a.EST_TP || null, rio: a.RIO_NM || null, responsavel: a.ORG_SG_RESPONSAVEL || null, operador: a.ORG_SG_OPERADOR || null,
      operando: a.OPERANDO || null, possuiDados: a.POSSUI_DADOS || null, areaDrenagemKm2: a.ARD_VR ?? null, municipio: a.MUN_NM || null, uf: a.UFD_SG || null,
      codigoPluviometrica: a.EST_CD_PLU || null, codigoFluviometrica: a.EST_CD_FLU || null,
      qualidadeAgua: a.TP_ESTACAOQUALAGUA || null, sedimentos: a.TP_ESTACAOSEDIMENTOS || null,
      distanciaKm: d != null ? round1(d) : null,
    };
  }, 30);
  const outorgasR = sub(outorgas, 25, (f) => {
    const a = f.attributes || {}; const g = f.geometry || {};
    const d = g.x != null && g.y != null ? haversineKm(p.lat, p.lon, g.y, g.x) : null;
    const dt = (v: any) => (v != null && Number.isFinite(Number(v)) ? new Date(Number(v)).toISOString().slice(0, 10) : v || null);
    return {
      nome: a.NOME_EMPREENDIMENTO || a.NOME_DO_REQUERENTE || null, requerente: a.NOME_DO_REQUERENTE || null, processo: a.NUMERO_PROCESSO || null,
      corpoHidrico: a.CORPO_HIDRICO || null, finalidade: a.FINALIDADE_PRINCIPAL || null, interferencia: a.TIPO_INTERFERENCIA || null,
      publicacao: dt(a.DATA_DE_PUBLICACAO), vencimento: dt(a.DATA_DE_VENCIMENTO), volumeAnualM3: a.VOLUME_ANUAL_M3 ?? null,
      municipio: a.MUNICIPIO || null, uf: a.UF || null, distanciaKm: d != null ? round1(d) : null,
    };
  }, 30);
  const partes = [cursosR, estacoesR, outorgasR];
  const todasIndisponiveis = partes.every((x) => x.estado === "indisponivel");
  if (todasIndisponiveis) return indisponivel(base, partes.map((x) => x.motivo).join("; "));
  const total = partes.reduce((s, x) => s + x.total, 0);
  const falhas = partes.filter((x) => x.estado === "indisponivel").map((x) => x.motivo);
  return {
    ...base,
    estado: total ? "registro" : "sem_registro",
    consultadoEm: agora(),
    total,
    ...(falhas.length ? { motivo: `camada(s) indisponível(is): ${falhas.join("; ")}` } : {}),
    data: { cursosDagua: cursosR, estacoes: estacoesR, outorgasFederais: outorgasR },
  };
}

// ── Orquestração ────────────────────────────────────────────────────────────

export interface ResultadoPesquisaComplementar {
  versao: 1;
  parametros: { lat: number; lon: number; substancia: string; grupo: string; termos: string[]; uf: string | null; municipio: string | null; processoAnm: string | null; raioKm: number };
  fontes: Partial<Record<FonteId, FonteResultado>>;
  resumo: { registro: number; semRegistro: number; indisponiveis: number; duracaoMs: number };
  consultadoEm: string;
}

const cacheKeyFonte = (id: FonteId, p: ParametrosPesquisa, classe: SubstanciaClassificada): string => {
  const lat = Math.round(p.lat * 10000) / 10000, lon = Math.round(p.lon * 10000) / 10000;
  switch (id) {
    case "rigeo": return `pc_rigeo:${classe.termos[0] || ""}:${(p.municipio || "").toLowerCase()}:${(p.uf || "").toUpperCase()}`;
    case "processosVizinhos": return `pc_viz:${lat},${lon}:${p.raioKm || 25}:${(p.processoAnm || "").replace(/\D/g, "")}:${classe.normalizada}`;
    case "sgbContexto": return `pc_sgb:${lat},${lon}`;
    case "afloramentos": return `pc_aflo:${lat},${lon}`;
    case "litoDetalhada": return `pc_lito:${lat},${lon}`;
    case "recursosHidricos": return `pc_hidr:${lat},${lon}`;
  }
};

/**
 * Executa as fontes pedidas (ou todas) em paralelo, com cache por fonte (só
 * sucesso é cacheado) e limites fixos de tempo/volume. `anterior` permite
 * atualização seletiva: fonte que falhar agora preserva o último resultado
 * válido, marcado com `atualizacaoFalhou`.
 */
export async function executarPesquisaComplementar(
  p: ParametrosPesquisa,
  anterior?: ResultadoPesquisaComplementar | null,
): Promise<ResultadoPesquisaComplementar> {
  const inicio = Date.now();
  const classe = classificarSubstancia(p.substancia);
  const ids: FonteId[] = (p.fontes && p.fontes.length ? p.fontes : FONTES_COMPLEMENTARES.map((f) => f.id))
    .filter((id): id is FonteId => FONTES_COMPLEMENTARES.some((f) => f.id === id));
  const executores: Record<FonteId, () => Promise<FonteResultado>> = {
    rigeo: () => fonteRigeo(p, classe),
    processosVizinhos: () => fonteProcessosVizinhos(p, classe),
    sgbContexto: () => fonteSgbContexto(p),
    afloramentos: () => fonteAfloramentos(p),
    litoDetalhada: () => fonteLitoDetalhada(p),
    recursosHidricos: () => fonteRecursosHidricos(p),
  };
  const fontes: Partial<Record<FonteId, FonteResultado>> = { ...(anterior?.fontes || {}) };
  await Promise.all(ids.map(async (id) => {
    const key = cacheKeyFonte(id, p, classe);
    let resultado: FonteResultado | null = null;
    if (!p.refresh) {
      try { resultado = await getCached<FonteResultado>("anm_enrich", key); } catch { resultado = null; }
    }
    if (!resultado) {
      try {
        resultado = await executores[id]();
      } catch (e: any) {
        const meta = FONTES_COMPLEMENTARES.find((f) => f.id === id)!;
        resultado = { id, label: meta.label, fonte: meta.label, atribuicao: "", vinculo: "regional", estado: "indisponivel", motivo: e?.message || "erro inesperado", consultadoEm: agora(), cobertura: "" };
      }
      if (resultado.estado !== "indisponivel") {
        try { await setCached("anm_enrich", key, resultado); } catch { /* cache é best-effort */ }
      }
    }
    const prev = anterior?.fontes?.[id];
    if (resultado.estado === "indisponivel" && prev && prev.estado !== "indisponivel") {
      // atualização seletiva: preserva o último resultado válido, com a falha registrada
      fontes[id] = { ...prev, atualizacaoFalhou: { em: resultado.consultadoEm, motivo: resultado.motivo || "indisponível" } };
    } else {
      fontes[id] = resultado;
    }
  }));
  const lista = Object.values(fontes) as FonteResultado[];
  return {
    versao: 1,
    parametros: {
      lat: p.lat, lon: p.lon, substancia: p.substancia, grupo: classe.grupo, termos: classe.termos,
      uf: p.uf || null, municipio: p.municipio || null, processoAnm: p.processoAnm || null, raioKm: p.raioKm || 25,
    },
    fontes,
    resumo: {
      registro: lista.filter((f) => f.estado === "registro").length,
      semRegistro: lista.filter((f) => f.estado === "sem_registro").length,
      indisponiveis: lista.filter((f) => f.estado === "indisponivel").length,
      duracaoMs: Date.now() - inicio,
    },
    consultadoEm: agora(),
  };
}
