// Descoberta de camadas WFS via GetCapabilities: nome (os nomes mudam entre versões dos servidores)
// e extensão publicada (WGS84BoundingBox) — uma camada pode existir e responder "vazio" só porque
// a área consultada está fora da sua cobertura. Parte pura (escolherCamada, extrairExtensao) testável sem rede.

export interface ExtensaoWfs { minLon: number; minLat: number; maxLon: number; maxLat: number }

function blocosFeatureType(capabilitiesXml: string): string[] {
  return capabilitiesXml.match(/<(?:\w+:)?FeatureType[\s>][\s\S]*?<\/(?:\w+:)?FeatureType>/g) || [];
}
function nomeDoBloco(b: string): string | undefined {
  return b.match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/)?.[1]?.trim();
}

export function escolherCamada(capabilitiesXml: string, padrao: RegExp, preferir?: RegExp, evitar?: RegExp): string | null {
  const candidatos: string[] = [];
  for (const b of blocosFeatureType(capabilitiesXml)) {
    const nome = nomeDoBloco(b);
    const titulo = b.match(/<(?:\w+:)?Title>([^<]*)<\/(?:\w+:)?Title>/)?.[1]?.trim() ?? "";
    if (!nome) continue;
    if (!padrao.test(nome) && !padrao.test(titulo)) continue;
    if (evitar && (evitar.test(nome) || evitar.test(titulo))) continue;
    candidatos.push(nome);
  }
  if (candidatos.length === 0) return null;
  return (preferir && candidatos.find((n) => preferir.test(n))) || candidatos[0];
}

/** Extensão publicada da camada (ows:WGS84BoundingBox é sempre lon lat, independentemente do CRS nativo). */
export function extrairExtensao(capabilitiesXml: string, typeName: string): ExtensaoWfs | null {
  for (const b of blocosFeatureType(capabilitiesXml)) {
    if (nomeDoBloco(b) !== typeName) continue;
    const lc = b.match(/<(?:\w+:)?LowerCorner>\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*<\/(?:\w+:)?LowerCorner>/);
    const uc = b.match(/<(?:\w+:)?UpperCorner>\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s*<\/(?:\w+:)?UpperCorner>/);
    if (!lc || !uc) return null;
    const e = { minLon: Number(lc[1]), minLat: Number(lc[2]), maxLon: Number(uc[1]), maxLat: Number(uc[2]) };
    if ([e.minLon, e.minLat, e.maxLon, e.maxLat].some((v) => !Number.isFinite(v))) return null;
    if (Math.abs(e.minLon) > 180 || Math.abs(e.maxLon) > 180 || Math.abs(e.minLat) > 90 || Math.abs(e.maxLat) > 90) return null;
    return e;
  }
  return null;
}

/** true quando a caixa consultada está inteiramente dentro da extensão publicada da camada. */
export function caixaDentroDaExtensao(caixa: ExtensaoWfs, extensao: ExtensaoWfs): boolean {
  return caixa.minLon >= extensao.minLon && caixa.maxLon <= extensao.maxLon &&
    caixa.minLat >= extensao.minLat && caixa.maxLat <= extensao.maxLat;
}

const CACHE_MS = 24 * 3600 * 1000;
const cacheCapabilities = new Map<string, { xml: string; ate: number }>();

async function capabilities(baseUrl: string): Promise<string | null> {
  const c = cacheCapabilities.get(baseUrl);
  if (c && c.ate > Date.now()) return c.xml;
  try {
    const r = await fetch(`${baseUrl}?service=WFS&request=GetCapabilities`, { signal: AbortSignal.timeout(40000) });
    if (!r.ok) return null; // não guarda falha em cache
    const xml = await r.text();
    if (!/FeatureTypeList/.test(xml)) return null;
    cacheCapabilities.set(baseUrl, { xml, ate: Date.now() + CACHE_MS });
    return xml;
  } catch {
    return null;
  }
}

const cacheNome = new Map<string, { nome: string | null; ate: number }>();

export async function descobrirCamadaWfs(baseUrl: string, padrao: RegExp, opts: { preferir?: RegExp; evitar?: RegExp } = {}): Promise<string | null> {
  const chave = `${baseUrl}|${padrao.toString()}|${opts.preferir?.toString()}|${opts.evitar?.toString()}`;
  const c = cacheNome.get(chave);
  if (c && c.ate > Date.now()) return c.nome;
  const xml = await capabilities(baseUrl);
  if (!xml) return null;
  const nome = escolherCamada(xml, padrao, opts.preferir, opts.evitar);
  cacheNome.set(chave, { nome, ate: Date.now() + CACHE_MS });
  return nome;
}

/** Extensão publicada da camada; null quando o GetCapabilities falhou ou a camada não está listada. */
export async function extensaoCamadaWfs(baseUrl: string, typeName: string): Promise<ExtensaoWfs | null> {
  const xml = await capabilities(baseUrl);
  return xml ? extrairExtensao(xml, typeName) : null;
}
