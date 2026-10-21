// Importador da dívida ativa da União (dados abertos trimestrais da PGFN).
// Fonte: https://dadosabertos.pgfn.gov.br/ — diretório aberto com zips por
// trimestre e categoria (FGTS ~18 MB, Previdenciário ~83 MB, Não
// Previdenciário ~1,3 GB). A API pública em tempo real foi descontinuada
// (ver .agents/memory/pgfn-divida-ativa.md), então importamos o dump em
// base local, agregado por devedor + categoria.
//
// Padrão do CFEM: baixar com curl para disco (streams fetch longos são
// frágeis), parse em streaming (unzip -p | readline), gravação em lotes com
// upsert somando — o mesmo devedor aparece em vários CSVs do mesmo zip.
import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { createInterface } from "readline";
import { unlink } from "fs/promises";
import iconv from "iconv-lite";
import { db } from "../db";
import { pgfnDividaAtiva } from "@shared/schema";
import { pgfnHeader, pgfnRow } from "./pgfn-csv";
import { sql, eq } from "drizzle-orm";
import { saveImportStatus, getImportStatus } from "./import-status";

const execFileAsync = promisify(execFile);

const PGFN_BASE_URL = "https://dadosabertos.pgfn.gov.br";
const BATCH_SIZE = 500;
// Flush do buffer de agregação a cada N devedores distintos para limitar
// memória (o Não Previdenciário tem milhões de devedores).
const FLUSH_KEYS = 200_000;

export const PGFN_CATEGORIAS = {
  FGTS: "Dados_abertos_FGTS.zip",
  PREVIDENCIARIO: "Dados_abertos_Previdenciario.zip",
  NAO_PREVIDENCIARIO: "Dados_abertos_Nao_Previdenciario.zip",
} as const;
export type PgfnCategoria = keyof typeof PGFN_CATEGORIAS;

const IMPORT_STATUS_FONTE = "pgfn";

let _importRunning = false;
export function isPgfnImportRunning() { return _importRunning; }
export function setPgfnImportRunning(v: boolean) { _importRunning = v; }

interface PgfnImportResult {
  status: string;
  referencia: string | null;
  totalRows: number;
  imported: number;
  errors: number;
  categoriasProcessadas: string[];
  startedAt: Date;
  finishedAt: Date | null;
  errorDetails?: string;
}

let lastImportResult: PgfnImportResult | null = null;
export function getLastPgfnImportResult() { return lastImportResult; }

// Descobre o trimestre mais recente listado no diretório aberto da PGFN
export async function descobrirTrimestreMaisRecente(): Promise<string> {
  const res = await fetch(PGFN_BASE_URL + "/", { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`PGFN dados abertos retornou HTTP ${res.status}`);
  const html = await res.text();
  const refs = Array.from(html.matchAll(/(\d{4}_trimestre_\d{2})\//g)).map(m => m[1]);
  if (refs.length === 0) throw new Error("Nenhum trimestre encontrado no diretório da PGFN");
  return refs.sort().pop()!;
}

export function formatarReferencia(ref: string | null | undefined): string {
  const m = /^(\d{4})_trimestre_0?(\d+)$/.exec(String(ref || ""));
  return m ? `${m[1]} T${m[2]}` : String(ref || "");
}

interface DevedorAgg {
  cpfCnpj: string;
  tipoPessoa: string | null;
  nomeDevedor: string | null;
  uf: string | null;
  inscricoes: number;
  valorConsolidado: number;
}

async function flushAggs(categoria: PgfnCategoria, referencia: string, aggs: Map<string, DevedorAgg>) {
  const values = Array.from(aggs.values());
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE).map(r => ({
      ...r, categoria, referencia, importadoEm: new Date(),
    }));
    await db.insert(pgfnDividaAtiva)
      .values(batch)
      .onConflictDoUpdate({
        target: [pgfnDividaAtiva.cpfCnpj, pgfnDividaAtiva.categoria],
        set: {
          // O mesmo devedor pode reaparecer em outro CSV do mesmo zip: soma.
          inscricoes: sql`${pgfnDividaAtiva.inscricoes} + EXCLUDED.inscricoes`,
          valorConsolidado: sql`${pgfnDividaAtiva.valorConsolidado} + EXCLUDED.valor_consolidado`,
          nomeDevedor: sql`EXCLUDED.nome_devedor`,
          tipoPessoa: sql`EXCLUDED.tipo_pessoa`,
          uf: sql`EXCLUDED.uf`,
          referencia: sql`EXCLUDED.referencia`,
          importadoEm: sql`NOW()`,
        },
      });
  }
  return values.length;
}

async function baixarZip(referencia: string, categoria: PgfnCategoria): Promise<string> {
  const url = `${PGFN_BASE_URL}/${referencia}/${PGFN_CATEGORIAS[categoria]}`;
  const dest = `/tmp/pgfn_${categoria.toLowerCase()}.zip`;
  console.log(`[PGFN] Baixando ${url} -> ${dest}`);
  // curl para disco com resume (-C -) e retries: downloads longos via fetch
  // são frágeis (lição ANM); o servidor da PGFN suporta Range.
  await execFileAsync("curl", [
    "-fSL", "--retry", "5", "--retry-delay", "5", "-C", "-", "-o", dest, url,
  ], { timeout: 40 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
  return dest;
}

async function listarCsvsDoZip(zipPath: string): Promise<string[]> {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.split("\n").map(s => s.trim()).filter(s => s.toLowerCase().endsWith(".csv"));
}

// Layout do CSV (separador ';', latin1):
// CPF_CNPJ;TIPO_PESSOA;TIPO_DEVEDOR;NOME_DEVEDOR;UF_DEVEDOR;UNIDADE_RESPONSAVEL;
// ENTIDADE_RESPONSAVEL;UNIDADE_INSCRICAO;NUMERO_INSCRICAO;TIPO_SITUACAO_INSCRICAO;
// SITUACAO_INSCRICAO;RECEITA_PRINCIPAL;DATA_INSCRICAO;INDICADOR_AJUIZADO;VALOR_CONSOLIDADO
async function processarCsvDoZip(
  zipPath: string, csvName: string, categoria: PgfnCategoria, referencia: string,
  state: { totalRows: number; imported: number; errors: number },
  aggs: Map<string, DevedorAgg>,
): Promise<void> {
  const child = spawn("unzip", ["-p", zipPath, csvName], { stdio: ["ignore", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout.pipe(iconv.decodeStream("latin1")), crlfDelay: Infinity });

  let header: Map<string, number> | null = null;
  for await (const line of rl) {
    if (!header) { header = pgfnHeader(line); continue; }
    const trimmed = line.trim();
    if (!trimmed) continue;
    state.totalRows++;
    try {
      const { cpfCnpj, valor, tipoPessoa, nomeDevedor, uf } = pgfnRow(trimmed, header);
      const prev = aggs.get(cpfCnpj);
      if (prev) {
        prev.inscricoes += 1;
        prev.valorConsolidado += isNaN(valor) ? 0 : valor;
      } else {
        aggs.set(cpfCnpj, {
          cpfCnpj,
          tipoPessoa,
          nomeDevedor,
          uf,
          inscricoes: 1,
          valorConsolidado: isNaN(valor) ? 0 : valor,
        });
      }
    } catch {
      state.errors++;
    }

    if (aggs.size >= FLUSH_KEYS) {
      state.imported += await flushAggs(categoria, referencia, aggs);
      aggs.clear();
      console.log(`[PGFN] ${categoria}: flush parcial (${state.totalRows} linhas lidas)`);
    }
    if (state.totalRows % 500_000 === 0) {
      console.log(`[PGFN] Progresso: ${state.totalRows} linhas lidas (${aggs.size} devedores no buffer)`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`unzip -p saiu com código ${code} (${csvName})`)));
    child.on("error", reject);
  });
}

export async function importPgfnDividaAtiva(opts?: {
  categorias?: PgfnCategoria[];
  trimestre?: string;
}): Promise<{ referencia: string; totalRows: number; imported: number; errors: number; durationMs: number }> {
  const startedAt = new Date();
  const categorias = opts?.categorias?.length ? opts.categorias : (Object.keys(PGFN_CATEGORIAS) as PgfnCategoria[]);

  lastImportResult = {
    status: "running", referencia: opts?.trimestre || null,
    totalRows: 0, imported: 0, errors: 0,
    categoriasProcessadas: [], startedAt, finishedAt: null,
  };
  await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);

  try {
    const referencia = opts?.trimestre || await descobrirTrimestreMaisRecente();
    lastImportResult.referencia = referencia;
    console.log(`[PGFN] Importando dívida ativa — referência ${referencia}, categorias: ${categorias.join(", ")}`);

    const state = { totalRows: 0, imported: 0, errors: 0 };

    for (const categoria of categorias) {
      const zipPath = await baixarZip(referencia, categoria);
      // Idempotente: remove a carga anterior da categoria (qualquer trimestre)
      await db.delete(pgfnDividaAtiva).where(eq(pgfnDividaAtiva.categoria, categoria));

      const csvs = await listarCsvsDoZip(zipPath);
      console.log(`[PGFN] ${categoria}: ${csvs.length} CSVs no zip`);
      const aggs = new Map<string, DevedorAgg>();
      for (const csv of csvs) {
        await processarCsvDoZip(zipPath, csv, categoria, referencia, state, aggs);
      }
      state.imported += await flushAggs(categoria, referencia, aggs);
      aggs.clear();
      await unlink(zipPath).catch(() => {});

      lastImportResult.categoriasProcessadas.push(categoria);
      lastImportResult.totalRows = state.totalRows;
      lastImportResult.imported = state.imported;
      lastImportResult.errors = state.errors;
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      console.log(`[PGFN] ${categoria}: concluído (${state.totalRows} linhas acumuladas, ${state.imported} devedores gravados)`);
    }

    if (state.errors > 0) {
      throw new Error(`Carga PGFN incompleta: ${state.errors} linhas inválidas de ${state.totalRows}; não considerar a base integralmente atualizada.`);
    }
    const durationMs = Date.now() - startedAt.getTime();
    lastImportResult = {
      ...lastImportResult, status: "completed",
      finishedAt: new Date(),
    };
    await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
    console.log(`[PGFN] Importação concluída: ${state.imported} devedores de ${state.totalRows} inscrições em ${(durationMs / 1000).toFixed(0)}s (${state.errors} erros)`);
    return { referencia, ...state, durationMs };
  } catch (e: any) {
    lastImportResult = { ...lastImportResult!, status: "error", finishedAt: new Date(), errorDetails: e?.message || String(e) };
    await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
    throw e;
  }
}

// ── consultas ──

export interface PgfnConsulta {
  baseImportada: boolean;
  referencia: string | null;
  temDebitoAtivo: boolean | null;
  valorConsolidado: number;
  inscricoes: number;
  categorias: Array<{ categoria: string; valorConsolidado: number; inscricoes: number }>;
  /** Categorias presentes na base local — se faltar alguma, "sem débitos" é parcial */
  categoriasImportadas: string[];
  nomeDevedor: string | null;
}

export async function consultarDividaAtivaLocal(cnpj: string): Promise<PgfnConsulta> {
  const digits = cnpj.replace(/\D/g, "");
  const stats = await getPgfnStats();
  if (stats.totalRegistros === 0) {
    return { baseImportada: false, referencia: null, temDebitoAtivo: null, valorConsolidado: 0, inscricoes: 0, categorias: [], categoriasImportadas: [], nomeDevedor: null };
  }
  const rows = digits.length === 14
    ? await db.select().from(pgfnDividaAtiva).where(eq(pgfnDividaAtiva.cpfCnpj, digits))
    : [];
  const valorConsolidado = rows.reduce((s, r) => s + Number(r.valorConsolidado || 0), 0);
  const inscricoes = rows.reduce((s, r) => s + Number(r.inscricoes || 0), 0);
  return {
    baseImportada: true,
    referencia: rows[0]?.referencia || stats.referencia,
    temDebitoAtivo: rows.length > 0,
    valorConsolidado: Math.round(valorConsolidado * 100) / 100,
    inscricoes,
    categorias: rows.map(r => ({
      categoria: r.categoria,
      valorConsolidado: Math.round(Number(r.valorConsolidado || 0) * 100) / 100,
      inscricoes: Number(r.inscricoes || 0),
    })),
    categoriasImportadas: stats.porCategoria.map(c => c.categoria),
    nomeDevedor: rows[0]?.nomeDevedor || null,
  };
}

export async function getPgfnStats() {
  const [c] = await db.select({
    total: sql<number>`COUNT(*)`,
    referencia: sql<string | null>`MAX(${pgfnDividaAtiva.referencia})`,
    ultimoImportadoEm: sql<string | null>`MAX(${pgfnDividaAtiva.importadoEm})`,
  }).from(pgfnDividaAtiva);
  const porCategoria = await db.select({
    categoria: pgfnDividaAtiva.categoria,
    devedores: sql<number>`COUNT(*)`,
    valorTotal: sql<number>`SUM(${pgfnDividaAtiva.valorConsolidado})`,
  }).from(pgfnDividaAtiva).groupBy(pgfnDividaAtiva.categoria);

  const ultimaImportacao: PgfnImportResult | null =
    lastImportResult ?? await getImportStatus<PgfnImportResult>(IMPORT_STATUS_FONTE);

  return {
    totalRegistros: Number(c?.total || 0),
    referencia: c?.referencia || null,
    porCategoria: porCategoria.map(r => ({
      categoria: r.categoria,
      devedores: Number(r.devedores || 0),
      valorTotal: Number(r.valorTotal || 0),
    })),
    ultimaImportacao,
  };
}
