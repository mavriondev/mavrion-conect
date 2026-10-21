// Fallback para o geoportal ANM (WAF bloqueia `where` com aspas simples desde ago/2026).
// Consulta a base SIGMINE espelhada na API Mavrion (ver .agents/memory/anm-geoportal-waf.md).

const MAVRION_API_URL = "https://api.mavrionconnect.com.br";

let _token: string | null = null;
let _tokenExp = 0;

async function getToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && _token && Date.now() < _tokenExp) return _token;
  const user = process.env.MAVRION_API_USER;
  const pass = process.env.MAVRION_API_PASS;
  if (!user || !pass) return null;
  try {
    const resp = await fetch(`${MAVRION_API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    _token = data.token || data.accessToken || null;
    _tokenExp = Date.now() + 6 * 24 * 60 * 60 * 1000;
    return _token;
  } catch {
    return null;
  }
}

async function apiFetch(path: string, timeout = 20000): Promise<any | null> {
  let token = await getToken();
  if (!token) return null;
  try {
    let resp = await fetch(`${MAVRION_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeout),
    });
    if (resp.status === 401 || resp.status === 403) {
      token = await getToken(true);
      if (!token) return null;
      resp = await fetch(`${MAVRION_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeout),
      });
    }
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function rowToAttrs(r: any): any {
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

async function findProcessoRow(processo: string, includeGeometry: boolean): Promise<any | null> {
  const clean = processo.replace(/[^0-9/]/g, "");
  if (!clean || clean.length < 3) return null;
  const geomParam = includeGeometry ? "&include_geometry=true" : "";
  const data = await apiFetch(`/api/anm/processos?search=${encodeURIComponent(clean)}${geomParam}&limit=5`);
  if (!data || !Array.isArray(data.rows)) return null;
  return data.rows.find((r: any) => r.processo === clean) || null;
}

/** Atributos do processo (formato do geoportal: PROCESSO, NOME, FASE, ...) ou null. */
export async function fetchAnmProcessoAttrsFallback(processo: string): Promise<any | null> {
  const row = await findProcessoRow(processo, false);
  return row ? rowToAttrs(row) : null;
}

/** Geometria GeoJSON (Polygon/MultiPolygon) do processo + atributos, ou null. */
export async function fetchAnmProcessoGeometryFallback(
  processo: string,
): Promise<{ attrs: any; geometry: any } | null> {
  const row = await findProcessoRow(processo, true);
  if (!row || !row.geometry) return null;
  return { attrs: rowToAttrs(row), geometry: row.geometry };
}
