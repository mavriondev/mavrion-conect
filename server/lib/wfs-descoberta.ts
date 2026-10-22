// Descoberta do nome de camada WFS via GetCapabilities (os nomes mudam entre versões dos servidores).
// Parte pura (escolherCamada) testável sem rede.

export function escolherCamada(capabilitiesXml: string, padrao: RegExp, preferir?: RegExp, evitar?: RegExp): string | null {
  const blocos = capabilitiesXml.match(/<(?:\w+:)?FeatureType[\s>][\s\S]*?<\/(?:\w+:)?FeatureType>/g) || [];
  const candidatos: string[] = [];
  for (const b of blocos) {
    const nome = b.match(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/)?.[1]?.trim();
    const titulo = b.match(/<(?:\w+:)?Title>([^<]*)<\/(?:\w+:)?Title>/)?.[1]?.trim() ?? "";
    if (!nome) continue;
    if (!padrao.test(nome) && !padrao.test(titulo)) continue;
    if (evitar && (evitar.test(nome) || evitar.test(titulo))) continue;
    candidatos.push(nome);
  }
  if (candidatos.length === 0) return null;
  return (preferir && candidatos.find((n) => preferir.test(n))) || candidatos[0];
}

const cache = new Map<string, { nome: string | null; ate: number }>();

export async function descobrirCamadaWfs(baseUrl: string, padrao: RegExp, opts: { preferir?: RegExp; evitar?: RegExp } = {}): Promise<string | null> {
  const chave = `${baseUrl}|${padrao.toString()}|${opts.preferir?.toString()}|${opts.evitar?.toString()}`;
  const c = cache.get(chave);
  if (c && c.ate > Date.now()) return c.nome;
  try {
    const r = await fetch(`${baseUrl}?service=WFS&request=GetCapabilities`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null; // não guarda falha em cache
    const nome = escolherCamada(await r.text(), padrao, opts.preferir, opts.evitar);
    cache.set(chave, { nome, ate: Date.now() + 24 * 3600 * 1000 });
    return nome;
  } catch {
    return null;
  }
}
