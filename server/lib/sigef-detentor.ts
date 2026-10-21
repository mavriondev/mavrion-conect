// Detentor de parcelas SIGEF — descoberta automática do nome do detentor.
//
// Estratégia (validada ago/2026):
// 1. O SIGEF (sigef.incra.gov.br/geo/parcela/detalhe/<codigo>/) passou a exigir
//    login gov.br e tem anti-bot F5. Fazemos UMA única sondagem por consulta;
//    se o acesso público estiver restabelecido, usamos a página ao vivo.
// 2. Fallback: Wayback Machine (web.archive.org) guarda snapshots reais das
//    páginas de detalhe antigas, com o painel "Identificação do detentor"
//    (nome sem CPF completo). Buscamos o snapshot mais recente por parcela.
//
// Tudo é melhor esforço com orçamento de tempo global — falhas nunca quebram
// a consulta SIGEF; o campo `detentor` simplesmente fica vazio.

const DETALHE_URL = (codigo: string) =>
  `https://sigef.incra.gov.br/geo/parcela/detalhe/${encodeURIComponent(codigo)}/`;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
}

function limparTexto(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Extrai o(s) nome(s) do detentor do HTML da página de detalhe da parcela.
 * Estrutura real (páginas SIGEF): painel "Identificação do detentor" com
 * tabela cujas colunas são Nome | CPF/CNPJ.
 */
export function extrairDetentorDoHtml(html: string): string | null {
  if (!html || !/detentor/i.test(html)) return null;
  const nomes: string[] = [];

  // Padrão principal: painel "Identificação do detentor" → primeira coluna (<td>) de cada linha
  const idx = html.search(/Identifica[çc][ãa]o do detentor/i);
  if (idx >= 0) {
    // recorta até o próximo painel/section para não vazar em outras tabelas
    const trecho = html.slice(idx, idx + 8000);
    const fim = trecho.search(/panel-header|<\/section|<h[12][\s>]/i);
    const bloco = fim > 200 ? trecho.slice(0, fim) : trecho;
    const reRow = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = reRow.exec(bloco)) !== null) {
      const txt = limparTexto(m[1]);
      if (txt && txt !== "—" && txt !== "-" && !/^\*+/.test(txt)) nomes.push(txt);
    }
  }

  // Padrões alternativos (layouts antigos/variantes)
  if (nomes.length === 0) {
    const reCell = /Detentor(?:\(es\)|es)?\s*:?\s*<\/(?:th|td|label|strong|b|span|dt)>\s*<(?:td|dd|span|div)[^>]*>([\s\S]*?)<\/(?:td|dd|span|div)>/gi;
    let m: RegExpExecArray | null;
    while ((m = reCell.exec(html)) !== null) {
      const txt = limparTexto(m[1]);
      if (txt && txt !== "—" && txt !== "-") nomes.push(txt);
    }
  }
  if (nomes.length === 0) {
    const reInline = /Detentor(?:\(es\)|es)?\s*:\s*([^<\n]{3,150})/gi;
    let m: RegExpExecArray | null;
    while ((m = reInline.exec(html)) !== null) {
      const txt = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
      if (txt) nomes.push(txt);
    }
  }

  if (nomes.length === 0) return null;
  return Array.from(new Set(nomes)).join("; ").slice(0, 300);
}

async function fetchTexto(url: string, timeoutMs: number): Promise<{ finalUrl: string; html: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return null;
    return { finalUrl: resp.url || url, html: await resp.text() };
  } catch {
    return null;
  }
}

// Página ao vivo do SIGEF: só vale se NÃO fomos redirecionados para login/consulta
async function buscarDetentorAoVivo(codigo: string, timeoutMs: number): Promise<string | null> {
  const r = await fetchTexto(DETALHE_URL(codigo), timeoutMs);
  if (!r) return null;
  if (!/\/geo\/parcela\/detalhe\//i.test(r.finalUrl)) return null; // caiu no login gov.br
  return extrairDetentorDoHtml(r.html);
}

// Wayback: acha o snapshot 200 mais recente e extrai o detentor dele
async function buscarDetentorWayback(codigo: string, timeoutMs: number): Promise<string | null> {
  try {
    const cdxUrl =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`sigef.incra.gov.br/geo/parcela/detalhe/${codigo}/`)}` +
      `&output=json&filter=statuscode:200&limit=-1&fl=timestamp,original`;
    const resp = await fetch(cdxUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const rows = await resp.json().catch(() => null) as string[][] | null;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const [timestamp, original] = rows[rows.length - 1];
    if (!timestamp || !original) return null;
    // sufixo id_ = conteúdo original sem toolbar do archive
    const snap = await fetchTexto(`https://web.archive.org/web/${timestamp}id_/${original}`, timeoutMs);
    if (!snap) return null;
    return extrairDetentorDoHtml(snap.html);
  } catch {
    return null;
  }
}

// Cache em memória: código da parcela → detentor (ou null = já buscado, não achou).
// Os snapshots do Wayback são imutáveis, então o cache não expira no processo.
const cacheDetentor = new Map<string, string | null>();

/**
 * Busca detentores de várias parcelas com orçamento de tempo global.
 * - 1 sondagem ao vivo (se o SIGEF público voltar, usa a fonte ao vivo);
 * - senão, Wayback Machine (archive.org é lento — ~5-8 s por requisição —
 *   e sensível a rajadas, por isso concorrência baixa e orçamento estrito).
 * Retorna Map codigoParcela → detentor (apenas os encontrados). Nunca lança.
 */
export async function buscarDetentoresParcelas(
  codigos: string[],
  opts: { maxParcelas?: number; orcamentoMs?: number } = {},
): Promise<Map<string, string>> {
  const { maxParcelas = 15, orcamentoMs = 25000 } = opts;
  const unicos = Array.from(new Set(codigos.filter(Boolean)));
  const resultado = new Map<string, string>();
  // cache primeiro (não consome orçamento)
  const fila: string[] = [];
  for (const c of unicos) {
    if (cacheDetentor.has(c)) {
      const d = cacheDetentor.get(c);
      if (d) resultado.set(c, d);
    } else if (fila.length < maxParcelas) {
      fila.push(c);
    }
  }
  if (fila.length === 0) return resultado;
  const deadline = Date.now() + orcamentoMs;
  const restante = () => deadline - Date.now();
  const timeoutReq = () => Math.max(2000, Math.min(15000, restante() - 500));

  try {
    // Sondagem única da fonte ao vivo (redireciona rápido para login quando bloqueada)
    const aoVivoOk = await (async () => {
      const d = await buscarDetentorAoVivo(fila[0], Math.min(6000, timeoutReq()));
      if (d) { resultado.set(fila[0], d); cacheDetentor.set(fila[0], d); return true; }
      return false;
    })();

    const buscar = aoVivoOk ? buscarDetentorAoVivo : buscarDetentorWayback;
    const pendentes = fila.filter((c) => !resultado.has(c));

    let idx = 0;
    const worker = async () => {
      for (;;) {
        if (restante() < 4000) return; // orçamento estourado — para sem quebrar nada
        const i = idx++;
        if (i >= pendentes.length) return;
        const codigo = pendentes[i];
        const detentor = await buscar(codigo, timeoutReq());
        if (detentor) {
          resultado.set(codigo, detentor);
          cacheDetentor.set(codigo, detentor);
        } else if (restante() > 4000) {
          // só marca como "não encontrado" se não foi corte por orçamento
          cacheDetentor.set(codigo, null);
        }
      }
    };
    const conc = aoVivoOk ? 4 : 3;
    await Promise.all(Array.from({ length: Math.min(conc, pendentes.length) }, worker));
  } catch { /* melhor esforço */ }
  return resultado;
}
