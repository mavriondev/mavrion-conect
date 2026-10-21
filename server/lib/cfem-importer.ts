// Importador da arrecadação CFEM (dados abertos da ANM).
// O CSV é mensal (~3M linhas); agregamos por ano antes de gravar para manter a
// tabela local compacta. O arquivo vem ordenado por Ano — fazemos flush a cada
// virada de ano para limitar memória.
// ATENÇÃO: dadosabertos.anm.gov.br tem WAF que bloqueia UA de bot/curl — é
// obrigatório usar headers de navegador (ver .agents/memory/anm-dados-abertos.md).
import { db } from "../db";
import { cfemArrecadacao } from "@shared/schema";
import { sql, and, eq } from "drizzle-orm";
import { Readable } from "stream";
import { createInterface } from "readline";
import iconv from "iconv-lite";
import { saveImportStatus, getImportStatus } from "./import-status";
import { downloadAnmCsvToDisk, ANM_BROWSER_HEADERS } from "./anm-csv-download";

// Re-export para compatibilidade com os módulos que importam daqui
export { ANM_BROWSER_HEADERS };

const CFEM_CSV_URL = "https://dadosabertos.anm.gov.br/CFEM/CFEM_Arrecadacao.csv";
const BATCH_SIZE = 500;

interface CfemAgg {
  processo: string;
  anoProcesso: number;
  ano: number;
  cpfCnpj: string;
  tipoPfPj: string | null;
  substancia: string;
  uf: string | null;
  codigoMunicipio: string;
  municipio: string | null;
  quantidade: number;
  unidade: string;
  valorRecolhido: number;
  registros: number;
}

let _importRunning = false;
export function isCfemImportRunning() { return _importRunning; }
export function setCfemImportRunning(v: boolean) { _importRunning = v; }

interface CfemImportResult {
  status: string;
  totalRows: number;
  imported: number;
  errors: number;
  anosProcessados: number[];
  startedAt: Date;
  finishedAt: Date | null;
  errorDetails?: string;
}

const IMPORT_STATUS_FONTE = "cfem";

let lastImportResult: CfemImportResult | null = null;

export function getLastCfemImportResult() { return lastImportResult; }

function parseDecimalBr(val: string | undefined): number {
  if (!val || val.trim() === "") return 0;
  const cleaned = val.trim().replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseQuotedCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// Flush de um ano agregado: delete + insert (idempotente). Se o mesmo ano
// reaparecer no arquivo (fora de ordem), soma via upsert em vez de substituir.
async function flushYear(ano: number, aggs: Map<string, CfemAgg>, alreadyFlushed: boolean) {
  const values = Array.from(aggs.values());
  if (values.length === 0) return 0;

  if (!alreadyFlushed) {
    await db.delete(cfemArrecadacao).where(eq(cfemArrecadacao.ano, ano));
  }

  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE).map(r => ({ ...r, importadoEm: new Date() }));
    await db.insert(cfemArrecadacao)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          cfemArrecadacao.processo, cfemArrecadacao.anoProcesso, cfemArrecadacao.ano,
          cfemArrecadacao.cpfCnpj, cfemArrecadacao.substancia, cfemArrecadacao.codigoMunicipio,
          cfemArrecadacao.unidade,
        ],
        set: alreadyFlushed
          ? {
              quantidade: sql`${cfemArrecadacao.quantidade} + EXCLUDED.quantidade`,
              valorRecolhido: sql`${cfemArrecadacao.valorRecolhido} + EXCLUDED.valor_recolhido`,
              registros: sql`${cfemArrecadacao.registros} + EXCLUDED.registros`,
              importadoEm: sql`NOW()`,
            }
          : {
              quantidade: sql`EXCLUDED.quantidade`,
              valorRecolhido: sql`EXCLUDED.valor_recolhido`,
              registros: sql`EXCLUDED.registros`,
              importadoEm: sql`NOW()`,
            },
      });
  }
  return values.length;
}

// anosFiltro: importa apenas os anos indicados (ex.: [2020..2026]); vazio = tudo.
export async function importCfemCsv(anosFiltro?: number[]): Promise<{
  totalRows: number;
  imported: number;
  errors: number;
  durationMs: number;
}> {
  const startedAt = new Date();
  lastImportResult = {
    status: "running", totalRows: 0, imported: 0, errors: 0,
    anosProcessados: [], startedAt, finishedAt: null,
  };
  await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);

  // Permite importar de um arquivo local (ex.: baixado antes com curl -C - para
  // sobreviver a quedas de conexão no download de ~318MB do WAF da ANM, que
  // costuma derrubar streams longos no meio)
  const localFile = process.env.CFEM_CSV_LOCAL_FILE;
  let inputStream: NodeJS.ReadableStream;
  let downloadCleanup: (() => void) | null = null;
  const { createReadStream } = await import("fs");
  if (localFile) {
    console.log("[CFEM] Importando de arquivo local:", localFile);
    inputStream = createReadStream(localFile);
  } else {
    // Download completo para disco antes de importar — o WAF da ANM mata
    // streams fetch longos silenciosamente (ver anm-csv-download.ts)
    let download;
    try {
      download = await downloadAnmCsvToDisk(CFEM_CSV_URL, "cfem");
    } catch (e: any) {
      const msg = `[CFEM] Download falhou: ${e?.message || e}`;
      lastImportResult = { ...lastImportResult!, status: "error", finishedAt: new Date(), errorDetails: msg };
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      throw new Error(msg);
    }
    downloadCleanup = download.cleanup;
    inputStream = createReadStream(download.filePath);
  }

  const rl = createInterface({ input: inputStream.pipe(iconv.decodeStream("latin1")), crlfDelay: Infinity });

  const filtro = anosFiltro && anosFiltro.length > 0 ? new Set(anosFiltro) : null;
  let totalRows = 0;
  let imported = 0;
  let errors = 0;
  let isFirstLine = true;
  let currentYear: number | null = null;
  let aggs = new Map<string, CfemAgg>();
  const flushedYears = new Set<number>();

  const doFlush = async () => {
    if (currentYear == null || aggs.size === 0) return;
    try {
      const n = await flushYear(currentYear, aggs, flushedYears.has(currentYear));
      imported += n;
      flushedYears.add(currentYear);
      lastImportResult!.anosProcessados = Array.from(flushedYears).sort();
      lastImportResult!.imported = imported;
      console.log(`[CFEM] Ano ${currentYear}: ${n} registros agregados gravados (${totalRows} linhas lidas)`);
    } catch (e: any) {
      console.error(`[CFEM] Erro ao gravar ano ${currentYear}:`, e.message);
      errors += aggs.size;
    }
    aggs = new Map();
  };

  try {
  for await (const line of rl) {
    if (isFirstLine) { isFirstLine = false; continue; }
    const trimmed = line.trim();
    if (!trimmed) continue;
    totalRows++;

    try {
      const f = parseQuotedCsvLine(trimmed);
      // "Ano","Mês","Processo","AnoDoProcesso","Tipo_PF_PJ","CPF_CNPJ","Substância","UF",
      // "CodigoMunicipio","Município","QuantidadeComercializada","UnidadeDeMedida","ValorRecolhido","DataCriacao"
      const ano = parseInt(f[0] || "", 10);
      if (!ano || ano < 1980 || ano > 2100) continue;
      if (filtro && !filtro.has(ano)) continue;

      if (currentYear !== null && ano !== currentYear) await doFlush();
      currentYear = ano;

      const processo = (f[2] || "").replace(/\D/g, "");
      const anoProcesso = parseInt(f[3] || "", 10) || 0;
      const cpfCnpj = (f[5] || "").replace(/[^0-9*]/g, "");
      const substancia = (f[6] || "").trim().toUpperCase();
      const uf = (f[7] || "").trim().toUpperCase() || null;
      const codigoMunicipio = (f[8] || "").replace(/\D/g, "");
      const municipio = (f[9] || "").trim() || null;
      const quantidade = parseDecimalBr(f[10]);
      const unidade = (f[11] || "").trim().toLowerCase();
      const valorRecolhido = parseDecimalBr(f[12]);
      const tipoPfPj = (f[4] || "").trim() || null;

      const key = `${processo}|${anoProcesso}|${cpfCnpj}|${substancia}|${codigoMunicipio}|${unidade}`;
      const prev = aggs.get(key);
      if (prev) {
        prev.quantidade += quantidade;
        prev.valorRecolhido += valorRecolhido;
        prev.registros += 1;
      } else {
        aggs.set(key, {
          processo, anoProcesso, ano, cpfCnpj, tipoPfPj, substancia, uf,
          codigoMunicipio, municipio, quantidade, unidade, valorRecolhido, registros: 1,
        });
      }
    } catch {
      errors++;
    }

    if (totalRows % 200000 === 0) {
      console.log(`[CFEM] Progresso: ${totalRows} linhas lidas (ano corrente ${currentYear}, ${aggs.size} chaves no buffer)`);
    }
  }

  await doFlush();
  } catch (e: any) {
    lastImportResult = { ...lastImportResult!, status: "error", finishedAt: new Date(), errorDetails: e?.message || String(e) };
    await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
    throw e;
  } finally {
    downloadCleanup?.();
  }

  const durationMs = Date.now() - startedAt.getTime();
  console.log(`[CFEM] Importação concluída: ${imported} registros agregados de ${totalRows} linhas em ${(durationMs / 1000).toFixed(1)}s (${errors} erros)`);
  lastImportResult = {
    status: "completed", totalRows, imported, errors,
    anosProcessados: Array.from(flushedYears).sort(), startedAt, finishedAt: new Date(),
  };
  await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
  return { totalRows, imported, errors, durationMs };
}

// ── consultas ──

export function splitProcesso(processo: string): { numero: string; ano: number } {
  const [numRaw, anoRaw] = String(processo || "").split("/");
  return { numero: (numRaw || "").replace(/\D/g, ""), ano: parseInt(anoRaw || "", 10) || 0 };
}

export async function getCfemByProcesso(processo: string) {
  const { numero, ano } = splitProcesso(processo);
  if (!numero) return [];
  const conds = [eq(cfemArrecadacao.processo, numero)];
  if (ano) conds.push(eq(cfemArrecadacao.anoProcesso, ano));
  return db.select().from(cfemArrecadacao)
    .where(and(...conds))
    .orderBy(sql`${cfemArrecadacao.ano} DESC, ${cfemArrecadacao.valorRecolhido} DESC`);
}

export async function getCfemByCnpj(cnpj: string) {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return { porAno: [], substancias: [], totalValor: 0, processosDistintos: 0 };
  const porAno = await db.select({
    ano: cfemArrecadacao.ano,
    valorTotal: sql<number>`SUM(${cfemArrecadacao.valorRecolhido})`,
    processos: sql<number>`COUNT(DISTINCT ${cfemArrecadacao.processo} || '/' || ${cfemArrecadacao.anoProcesso})`,
  }).from(cfemArrecadacao)
    .where(eq(cfemArrecadacao.cpfCnpj, digits))
    .groupBy(cfemArrecadacao.ano)
    .orderBy(sql`${cfemArrecadacao.ano} DESC`);
  const substancias = await db.select({
    substancia: cfemArrecadacao.substancia,
    valorTotal: sql<number>`SUM(${cfemArrecadacao.valorRecolhido})`,
  }).from(cfemArrecadacao)
    .where(eq(cfemArrecadacao.cpfCnpj, digits))
    .groupBy(cfemArrecadacao.substancia)
    .orderBy(sql`SUM(${cfemArrecadacao.valorRecolhido}) DESC`)
    .limit(10);
  const [tot] = await db.select({
    total: sql<number>`COALESCE(SUM(${cfemArrecadacao.valorRecolhido}), 0)`,
    processos: sql<number>`COUNT(DISTINCT ${cfemArrecadacao.processo} || '/' || ${cfemArrecadacao.anoProcesso})`,
  }).from(cfemArrecadacao).where(eq(cfemArrecadacao.cpfCnpj, digits));
  return {
    porAno: porAno.map(r => ({ ano: r.ano, valorTotal: Number(r.valorTotal || 0), processos: Number(r.processos || 0) })),
    substancias: substancias.map(r => ({ substancia: r.substancia, valorTotal: Number(r.valorTotal || 0) })),
    totalValor: Number(tot?.total || 0),
    processosDistintos: Number(tot?.processos || 0),
  };
}

export async function getCfemMunicipioContext(codigoMunicipio: string) {
  const codigo = codigoMunicipio.replace(/\D/g, "");
  if (!codigo) return null;
  const porAno = await db.select({
    ano: cfemArrecadacao.ano,
    valorTotal: sql<number>`SUM(${cfemArrecadacao.valorRecolhido})`,
  }).from(cfemArrecadacao)
    .where(eq(cfemArrecadacao.codigoMunicipio, codigo))
    .groupBy(cfemArrecadacao.ano)
    .orderBy(sql`${cfemArrecadacao.ano} DESC`)
    .limit(10);
  if (porAno.length === 0) return null;

  const topSubstancias = await db.select({
    substancia: cfemArrecadacao.substancia,
    valorTotal: sql<number>`SUM(${cfemArrecadacao.valorRecolhido})`,
  }).from(cfemArrecadacao)
    .where(eq(cfemArrecadacao.codigoMunicipio, codigo))
    .groupBy(cfemArrecadacao.substancia)
    .orderBy(sql`SUM(${cfemArrecadacao.valorRecolhido}) DESC`)
    .limit(5);

  const [info] = await db.select({
    municipio: cfemArrecadacao.municipio,
    uf: cfemArrecadacao.uf,
  }).from(cfemArrecadacao).where(eq(cfemArrecadacao.codigoMunicipio, codigo)).limit(1);

  // Ranking no último ano completo com dados
  const anoRef = porAno[0].ano === new Date().getFullYear() && porAno.length > 1 ? porAno[1].ano : porAno[0].ano;
  const ranking = await db.execute(sql`
    WITH totais AS (
      SELECT codigo_municipio, uf, SUM(valor_recolhido) AS total
      FROM cfem_arrecadacao WHERE ano = ${anoRef} AND codigo_municipio <> ''
      GROUP BY codigo_municipio, uf
    )
    SELECT
      (SELECT COUNT(*) + 1 FROM totais t2 WHERE t2.total > t1.total) AS rank_br,
      (SELECT COUNT(*) + 1 FROM totais t3 WHERE t3.uf = t1.uf AND t3.total > t1.total) AS rank_uf,
      (SELECT COUNT(*) FROM totais) AS total_municipios,
      t1.total
    FROM totais t1 WHERE t1.codigo_municipio = ${codigo}
  `);
  const rank = (ranking.rows?.[0] || null) as any;

  return {
    codigoMunicipio: codigo,
    municipio: info?.municipio || null,
    uf: info?.uf || null,
    porAno: porAno.map(r => ({ ano: r.ano, valorTotal: Number(r.valorTotal || 0) })),
    topSubstancias: topSubstancias.map(r => ({ substancia: r.substancia, valorTotal: Number(r.valorTotal || 0) })),
    anoReferencia: anoRef,
    rankBrasil: rank ? Number(rank.rank_br) : null,
    rankUf: rank ? Number(rank.rank_uf) : null,
    totalMunicipiosComCfem: rank ? Number(rank.total_municipios) : null,
    valorAnoReferencia: rank ? Number(rank.total) : null,
  };
}

export async function getCfemStats() {
  const [c] = await db.select({
    total: sql<number>`COUNT(*)`,
    anoMin: sql<number>`MIN(${cfemArrecadacao.ano})`,
    anoMax: sql<number>`MAX(${cfemArrecadacao.ano})`,
    ultimoImportadoEm: sql<string | null>`MAX(${cfemArrecadacao.importadoEm})`,
  }).from(cfemArrecadacao);

  // Status persistente: sobrevive a restart e a importações rodadas em
  // processo externo. Se a própria tabela tiver dados mais novos que o status
  // (carga externa que não gravou status, ou base anterior à tabela de
  // status), deriva o status de MAX(importado_em) — exceto durante uma
  // importação em andamento, quando o status "running" prevalece.
  let ultimaImportacao: CfemImportResult | null =
    lastImportResult ?? await getImportStatus<CfemImportResult>(IMPORT_STATUS_FONTE);
  const baseAtualizadaEm = c?.ultimoImportadoEm && Number(c?.total || 0) > 0
    ? new Date(c.ultimoImportadoEm) : null;
  const statusRef = ultimaImportacao?.finishedAt ? new Date(ultimaImportacao.finishedAt) : null;
  const baseMaisNova = baseAtualizadaEm && ultimaImportacao?.status !== "running" &&
    (!statusRef || baseAtualizadaEm.getTime() > statusRef.getTime());
  if (baseMaisNova) {
    ultimaImportacao = {
      status: "completed",
      totalRows: 0,
      imported: Number(c!.total),
      errors: 0,
      anosProcessados: [],
      startedAt: baseAtualizadaEm!,
      finishedAt: baseAtualizadaEm!,
    };
  }

  return {
    totalRegistros: Number(c?.total || 0),
    anoMin: c?.anoMin ? Number(c.anoMin) : null,
    anoMax: c?.anoMax ? Number(c.anoMax) : null,
    ultimaImportacao,
  };
}
