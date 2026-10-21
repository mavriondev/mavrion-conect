/**
 * Cliente compartilhado da Hub API Mavrion (api.mavrionconnect.com.br).
 *
 * A Hub API já concentra bases sincronizadas (SIGMINE espelhado, SGB
 * geocronologia/bacias, FUNAI, ICMBio, PGFN…). O Connect consome essas bases
 * em vez de duplicá-las. Este módulo só cuida de autenticação (bearer com
 * renovação) e devolve resultado com estado explícito: falha de rede/HTTP
 * nunca vira `null` silencioso — o chamador decide como registrar a fonte.
 */

const HUB_API_URL = process.env.MAVRION_API_URL || "https://api.mavrionconnect.com.br";

export type HubResult<T> =
  | { ok: true; data: T }
  | { ok: false; motivo: string; status?: number };

let _token: string | null = null;
let _tokenExp = 0;

async function obterToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && _token && Date.now() < _tokenExp) return _token;
  const user = process.env.MAVRION_API_USER;
  const pass = process.env.MAVRION_API_PASS;
  if (!user || !pass) return null;
  try {
    const resp = await fetch(`${HUB_API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user, password: pass }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    _token = data.token || data.accessToken || null;
    _tokenExp = Date.now() + 6 * 24 * 60 * 60 * 1000;
    return _token;
  } catch {
    return null;
  }
}

export function hubApiConfigurada(): boolean {
  return !!(process.env.MAVRION_API_USER && process.env.MAVRION_API_PASS);
}

/** GET autenticado na Hub API. */
export async function hubApiGet<T = any>(path: string, timeoutMs = 20000): Promise<HubResult<T>> {
  if (!hubApiConfigurada()) return { ok: false, motivo: "Hub API não configurada (credenciais ausentes)" };
  const token = await obterToken();
  if (!token) return { ok: false, motivo: "Hub API: falha de autenticação" };
  const executar = async (tk: string) => fetch(`${HUB_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${tk}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  try {
    let resp = await executar(token);
    if (resp.status === 401 || resp.status === 403) {
      const renovado = await obterToken(true);
      if (!renovado) return { ok: false, motivo: "Hub API: falha ao renovar autenticação", status: resp.status };
      resp = await executar(renovado);
    }
    if (!resp.ok) return { ok: false, motivo: `Hub API respondeu HTTP ${resp.status}`, status: resp.status };
    return { ok: true, data: (await resp.json()) as T };
  } catch (e: any) {
    const motivo = e?.name === "TimeoutError" || e?.name === "AbortError"
      ? `Hub API: tempo esgotado (${Math.round(timeoutMs / 1000)} s)`
      : `Hub API: ${e?.message || "erro de rede"}`;
    return { ok: false, motivo };
  }
}
