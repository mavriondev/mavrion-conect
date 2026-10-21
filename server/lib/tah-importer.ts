import { db } from "../db";
import { tahTitulares } from "@shared/schema";
import { sql } from "drizzle-orm";
import { createInterface } from "readline";
import iconv from "iconv-lite";
import { downloadAnmCsvToDisk } from "./anm-csv-download";
import { saveImportStatus, getImportStatus } from "./import-status";

// A ANM migrou os dados abertos de app.anm.gov.br (404) para dadosabertos.anm.gov.br.
// O novo domínio tem WAF que exige headers de navegador (ver ANM_BROWSER_HEADERS).
const TAH_CSV_URL = "https://dadosabertos.anm.gov.br/TAH/Tah.csv";
const BATCH_SIZE = 500;

interface TahRecord {
  processo: string;
  anoBase: number | null;
  cnpjCpf: string | null;
  nomeTitular: string | null;
  fase: string | null;
  uf: string | null;
  areaHa: number | null;
  dtQuitacao: string | null;
  valorCobrado: number | null;
  valorPago: number | null;
}

let _importRunning = false;

export function isImportRunning() {
  return _importRunning;
}

export function setImportRunning(val: boolean) {
  _importRunning = val;
}

interface TahImportResult {
  status: string;
  totalRows: number;
  imported: number;
  updated: number;
  errors: number;
  // Validação por PARES processo+ano: o CSV tem ~2,2 linhas por chave
  // (parcelas/retificações), então contagem de linhas NÃO serve para validar
  // a carga — ver .agents/memory/anm-dados-abertos.md
  chavesUnicasCsv?: number;
  chavesUnicasBanco?: number;
  validacao?: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorDetails?: string;
}

const IMPORT_STATUS_FONTE = "tah";

let lastImportResult: TahImportResult | null = null;

export function getLastImportResult() {
  return lastImportResult;
}

function parseDecimalBr(val: string | undefined): number | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.trim().replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseQuotedCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function extractUfFromSuperintendencia(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/GER\s*-\s*([A-Z]{2})/i);
  return m ? m[1].toUpperCase() : null;
}

function parseLine(fields: string[]): TahRecord | null {
  const processo = (fields[0] || "").trim();
  if (!processo || !/^\d+$/.test(processo)) return null;

  const anoBase = parseInt(fields[1] || "", 10) || null;
  const cnpjCpfRaw = (fields[2] || "").trim();
  const cnpjCpf = cnpjCpfRaw.replace(/\D/g, "");
  const nomeTitular = (fields[3] || "").trim() || null;
  const fase = (fields[4] || "").trim() || null;
  const superintendencia = (fields[5] || "").trim() || null;
  const uf = extractUfFromSuperintendencia(superintendencia);
  const areaHa = parseDecimalBr(fields[6]);
  const dtQuitacao = (fields[7] || "").trim() || null;
  const valorPago = parseDecimalBr(fields[8]);
  const valorCobrado = parseDecimalBr(fields[9]);

  return {
    processo,
    anoBase,
    cnpjCpf: cnpjCpf && cnpjCpf.length >= 11 ? cnpjCpf : null,
    nomeTitular,
    fase,
    uf,
    areaHa,
    dtQuitacao,
    valorCobrado,
    valorPago,
  };
}

async function upsertBatch(batch: TahRecord[]) {
  if (batch.length === 0) return;

  const deduped = new Map<string, TahRecord>();
  for (const r of batch) {
    const key = `${r.processo}|${r.anoBase ?? 0}`;
    deduped.set(key, r);
  }

  const values = Array.from(deduped.values()).map(r => ({
    processo: r.processo,
    anoBase: r.anoBase,
    cnpjCpf: r.cnpjCpf,
    nomeTitular: r.nomeTitular,
    fase: r.fase,
    uf: r.uf,
    areaHa: r.areaHa,
    dtQuitacao: r.dtQuitacao,
    valorCobrado: r.valorCobrado,
    valorPago: r.valorPago,
    importadoEm: new Date(),
  }));

  await db.insert(tahTitulares)
    .values(values)
    .onConflictDoUpdate({
      target: [tahTitulares.processo, tahTitulares.anoBase],
      set: {
        cnpjCpf: sql`EXCLUDED.cnpj_cpf`,
        nomeTitular: sql`EXCLUDED.nome_titular`,
        fase: sql`EXCLUDED.fase`,
        uf: sql`EXCLUDED.uf`,
        areaHa: sql`EXCLUDED.area_ha`,
        dtQuitacao: sql`EXCLUDED.dt_quitacao`,
        valorCobrado: sql`EXCLUDED.valor_cobrado`,
        valorPago: sql`EXCLUDED.valor_pago`,
        importadoEm: sql`NOW()`,
      },
    });

  return deduped.size;
}

export async function importTahCsv(): Promise<{
  totalRows: number;
  imported: number;
  errors: number;
  chavesUnicasCsv: number;
  chavesUnicasBanco: number;
  validacao: string;
  durationMs: number;
}> {
  const startedAt = new Date();
  lastImportResult = {
    status: "running",
    totalRows: 0,
    imported: 0,
    updated: 0,
    errors: 0,
    startedAt,
    finishedAt: null,
  };
  await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);

  // Download completo para disco antes de importar — o WAF da ANM mata
  // streams fetch longos silenciosamente no meio (ver anm-csv-download.ts).
  // TAH_CSV_LOCAL_FILE permite importar de um arquivo já baixado/saneado.
  const localFile = process.env.TAH_CSV_LOCAL_FILE;
  let filePath: string;
  let downloadCleanup: (() => void) | null = null;
  if (localFile) {
    console.log("[TAH] Importando de arquivo local:", localFile);
    filePath = localFile;
  } else {
    try {
      const download = await downloadAnmCsvToDisk(TAH_CSV_URL, "tah");
      filePath = download.filePath;
      downloadCleanup = download.cleanup;
    } catch (e: any) {
      const msg = `[TAH] Download falhou: ${e?.message || e}`;
      console.error(msg);
      lastImportResult = { ...lastImportResult!, status: "error", finishedAt: new Date(), errorDetails: msg };
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      throw new Error(msg);
    }
  }

  let totalRows = 0;
  let imported = 0;
  let errors = 0;
  // Chaves únicas processo+ano vistas no CSV — base da validação da carga
  const chavesCsv = new Set<string>();

  // Relógio do BANCO antes de qualquer escrita: a validação exige que cada
  // par do CSV esteja presente E com importado_em desta rodada (o upsert
  // grava NOW() em toda linha tocada), então um batch que falhou não conta.
  const t0res = await db.execute(sql`SELECT NOW() AS t0`);
  const dbT0 = new Date((t0res.rows?.[0] as any)?.t0);

  try {
    const { createReadStream } = await import("fs");
    const decodedStream = createReadStream(filePath).pipe(iconv.decodeStream("latin1"));
    const rl = createInterface({ input: decodedStream, crlfDelay: Infinity });

    let isFirstLine = true;
    let batch: TahRecord[] = [];

    for await (const line of rl) {
      if (isFirstLine) {
        isFirstLine = false;
        const headerFields = parseQuotedCsvLine(line);
        console.log("[TAH] Headers detectados:", headerFields.join(" | "));
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      totalRows++;

      try {
        const fields = parseQuotedCsvLine(trimmed);
        const record = parseLine(fields);
        if (!record) continue;

        chavesCsv.add(`${record.processo}|${record.anoBase ?? 0}`);
        batch.push(record);

        if (batch.length >= BATCH_SIZE) {
          try {
            await upsertBatch(batch);
            imported += batch.length;
          } catch (batchErr: any) {
            console.error(`[TAH] Erro no batch:`, batchErr.message);
            errors += batch.length;
          }
          batch = [];

          if (totalRows % 10000 === 0) {
            console.log(`[TAH] Progresso: ${imported} importados, ${totalRows} linhas processadas`);
          }
        }
      } catch (err) {
        errors++;
      }
    }

    if (batch.length > 0) {
      try {
        await upsertBatch(batch);
        imported += batch.length;
      } catch (batchErr: any) {
        console.error(`[TAH] Erro no batch final:`, batchErr.message);
        errors += batch.length;
      }
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    lastImportResult = { ...lastImportResult!, status: "error", totalRows, imported, errors, finishedAt: new Date(), errorDetails: msg };
    await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
    throw e;
  } finally {
    downloadCleanup?.();
  }

  // Validação por PARES processo+ano (não por linhas: o CSV tem ~2,2 linhas
  // por chave). Membership real: cada par visto no CSV precisa existir na
  // tabela COM importado_em desta rodada (>= dbT0) — uma base antiga com a
  // mesma cardinalidade mas pares diferentes, ou batches cujo upsert falhou,
  // reprovam a carga.
  const chavesUnicasCsv = chavesCsv.size;
  let chavesUnicasBanco = 0;
  try {
    chavesUnicasBanco = await contarChavesPresentesDesde(Array.from(chavesCsv), dbT0);
  } catch (e: any) {
    console.error("[TAH] Falha ao validar chaves no banco:", e.message);
  }

  const durationMs = Date.now() - startedAt.getTime();
  const { ok, validacao } = avaliarValidacaoTah({ chavesUnicasCsv, chavesPresentes: chavesUnicasBanco, errors });

  console.log(`[TAH] Importação concluída: ${imported} linhas em ${(durationMs / 1000).toFixed(1)}s (${errors} erros). Validação: ${validacao}`);

  lastImportResult = {
    status: ok ? "completed" : "error",
    totalRows,
    imported,
    updated: 0,
    errors,
    chavesUnicasCsv,
    chavesUnicasBanco,
    validacao,
    startedAt,
    finishedAt: new Date(),
    ...(ok ? {} : { errorDetails: validacao }),
  };
  await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);

  if (!ok) {
    // Falha VISÍVEL: propaga para o scheduler gravar lastError no connector
    // e registrar no log de erros de API
    throw new Error(`[TAH] Validação da carga falhou — ${validacao}`);
  }

  return { totalRows, imported, errors, chavesUnicasCsv, chavesUnicasBanco, validacao, durationMs };
}

/**
 * Conta quantas das chaves `processo|ano` do CSV estão presentes na tabela
 * com importado_em >= t0 (ou seja, efetivamente gravadas NESTA rodada).
 * Anti-join em chunks via unnest — membership exata, não cardinalidade.
 */
export async function contarChavesPresentesDesde(chaves: string[], t0: Date): Promise<number> {
  const CHUNK = 5000;
  let presentes = 0;
  for (let i = 0; i < chaves.length; i += CHUNK) {
    const chunk = chaves.slice(i, i + CHUNK);
    // Literais de array do Postgres: processo é só dígitos (validado no parse)
    // e ano é int, então a montagem é segura.
    const procs = `{${chunk.map(c => c.split("|")[0].replace(/\D/g, "")).join(",")}}`;
    const anos = `{${chunk.map(c => parseInt(c.split("|")[1], 10) || 0).join(",")}}`;
    const res = await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM unnest(${procs}::text[], ${anos}::int[]) AS k(p, a)
      WHERE EXISTS (
        SELECT 1 FROM tah_titulares t
        WHERE t.processo = k.p
          AND COALESCE(t.ano_base, 0) = k.a
          AND t.importado_em >= ${t0}
      )`);
    presentes += Number((res.rows?.[0] as any)?.n || 0);
  }
  return presentes;
}

/**
 * Decide se a carga TAH é válida. Exportada para testes.
 * - errors > 0 (batches de escrita que falharam) reprova sempre;
 * - exige que >= 99,9% dos pares processo+ano do CSV estejam presentes e
 *   gravados nesta rodada (chavesPresentes vem de contarChavesPresentesDesde).
 */
export function avaliarValidacaoTah(p: { chavesUnicasCsv: number; chavesPresentes: number; errors: number }): { ok: boolean; validacao: string } {
  const cobertura = p.chavesUnicasCsv > 0 ? p.chavesPresentes / p.chavesUnicasCsv : 0;
  if (p.errors > 0) {
    return { ok: false, validacao: `FALHA: ${p.errors} linha(s) em batches de escrita que falharam — carga incompleta (${p.chavesPresentes}/${p.chavesUnicasCsv} pares gravados nesta rodada)` };
  }
  if (p.chavesUnicasCsv === 0) {
    return { ok: false, validacao: "FALHA: CSV não trouxe nenhum par processo+ano válido" };
  }
  if (cobertura < 0.999) {
    return { ok: false, validacao: `FALHA: só ${p.chavesPresentes} de ${p.chavesUnicasCsv} pares processo+ano do CSV foram gravados nesta rodada (cobertura ${(cobertura * 100).toFixed(2)}%)` };
  }
  return { ok: true, validacao: `ok: ${p.chavesPresentes} de ${p.chavesUnicasCsv} pares processo+ano do CSV gravados nesta rodada` };
}

/**
 * Consulta TAH pelo número COMPLETO do processo (número + ano).
 * A coluna ano_base guarda o NRAnoProcesso dos dados abertos da ANM (o ano do
 * processo) — números-base são reutilizados entre anos por processos
 * distintos, então casar só pelo número-base mistura titulares alheios.
 * Quando o chamador só tem o número-base (sem ano), o resultado volta
 * marcado como ambíguo.
 */
export async function getTahByProcesso(processo: string): Promise<{
  registros: any[];
  ambiguo: boolean;
  ano: number | null;
  numero: string | null;
}> {
  const parts = String(processo || "").split("/");
  const processNum = parts[0].replace(/[^0-9]/g, "").replace(/^0+/, "").trim();
  const anoMatch = (parts[1] || "").match(/^(\d{4})/);
  const ano = anoMatch ? parseInt(anoMatch[1], 10) : null;

  if (!processNum) return { registros: [], ambiguo: false, ano, numero: null };

  const wrap = (rows: any[]) => {
    const registros = ano != null ? rows.filter(r => Number(r.anoBase) === ano) : rows;
    return { registros, ambiguo: ano == null && registros.length > 0, ano, numero: processNum };
  };

  const rows = await db
    .select()
    .from(tahTitulares)
    .where(sql`${tahTitulares.processo} = ${processNum}`)
    .orderBy(sql`${tahTitulares.anoBase} DESC`);

  if (rows.length > 0) {
    const wrapped = wrap(rows);
    // se há linhas do número-base mas nenhuma do ano exato, não devolve dados
    // alheios — mas a base local pode estar desatualizada (o CSV da ANM ganha
    // lançamentos novos), então ainda tenta o CSV online antes de devolver vazio
    if (ano == null || wrapped.registros.length > 0) return wrapped;
  }

  console.log(`[TAH] Processo ${processNum}${ano ? `/${ano}` : ""} não encontrado na base local, buscando online...`);
  const onlineRows = await fetchTahOnlineByProcesso(processNum);
  if (onlineRows.length > 0) {
    try {
      const deduped = new Map<string, TahRecord>();
      for (const r of onlineRows) {
        const key = `${r.processo}|${r.anoBase ?? 0}`;
        deduped.set(key, r);
      }
      const values = Array.from(deduped.values()).map(r => ({
        processo: r.processo,
        anoBase: r.anoBase,
        cnpjCpf: r.cnpjCpf,
        nomeTitular: r.nomeTitular,
        fase: r.fase,
        uf: r.uf,
        areaHa: r.areaHa,
        dtQuitacao: r.dtQuitacao,
        valorCobrado: r.valorCobrado,
        valorPago: r.valorPago,
        importadoEm: new Date(),
      }));
      await db.insert(tahTitulares).values(values).onConflictDoNothing();
      console.log(`[TAH] ${values.length} registro(s) do processo ${processNum} salvos na base local`);
    } catch (saveErr: any) {
      console.error(`[TAH] Erro ao salvar registros online:`, saveErr.message);
    }
  }
  const mapped = onlineRows.map(r => ({
    id: 0,
    processo: r.processo,
    anoBase: r.anoBase,
    cnpjCpf: r.cnpjCpf,
    nomeTitular: r.nomeTitular,
    tipoPessoa: null,
    fase: r.fase,
    uf: r.uf,
    areaHa: r.areaHa,
    dtQuitacao: r.dtQuitacao,
    valorCobrado: r.valorCobrado,
    valorPago: r.valorPago,
    importadoEm: new Date(),
  })).sort((a, b) => (b.anoBase ?? 0) - (a.anoBase ?? 0));
  const wrappedOnline = wrap(mapped);
  if (ano != null && wrappedOnline.registros.length === 0) {
    return { registros: [], ambiguo: false, ano, numero: processNum };
  }
  return wrappedOnline;
}

/**
 * Busca um processo no Tah.csv online quando ele não está na base local.
 * NÃO usa stream fetch direto: o WAF da ANM derruba streams fetch longos
 * silenciosamente no meio, e o resultado parcial parecia "processo não
 * existe". Baixa o CSV completo para disco via curl (downloadAnmCsvToDisk,
 * com retry/resume e validação de tamanho) e lê do arquivo local.
 * Qualquer falha de download/leitura PROPAGA como erro — vazio aqui
 * significa de fato "processo ausente no CSV", nunca truncamento.
 */
async function fetchTahOnlineByProcesso(processNum: string): Promise<TahRecord[]> {
  const { filePath, cleanup } = await downloadAnmCsvToDisk(TAH_CSV_URL, "tah-online");
  try {
    const { createReadStream } = await import("fs");
    const decodedStream = createReadStream(filePath).pipe(iconv.decodeStream("latin1"));
    const rl = createInterface({ input: decodedStream, crlfDelay: Infinity });

    const results: TahRecord[] = [];
    let isFirstLine = true;

    for await (const line of rl) {
      if (isFirstLine) {
        isFirstLine = false;
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;

      const fields = parseQuotedCsvLine(trimmed);
      const lineProcesso = (fields[0] || "").trim();

      if (lineProcesso !== processNum) continue;

      const record = parseLine(fields);
      if (record) results.push(record);
    }

    console.log(`[TAH Online] Encontrados ${results.length} registros para processo ${processNum}`);
    return results;
  } catch (err: any) {
    // Falha VISÍVEL: leitura truncada/erro de parse não vira "não encontrado"
    throw new Error(`[TAH Online] Falha ao ler CSV baixado: ${err?.message || err}`);
  } finally {
    cleanup();
  }
}

export async function getTahStats() {
  const [countResult] = await db.select({ total: sql<number>`COUNT(*)` }).from(tahTitulares);
  const [withCnpj] = await db.select({ total: sql<number>`COUNT(*)` }).from(tahTitulares)
    .where(sql`${tahTitulares.cnpjCpf} IS NOT NULL AND LENGTH(${tahTitulares.cnpjCpf}) >= 11`);

  // Status persistente: sobrevive a restarts e a importações rodadas fora
  // deste processo (o resultado em memória some a cada deploy — foi assim que
  // a base ficou parada de março a agosto/2026 sem ninguém perceber)
  const ultimaImportacao: TahImportResult | null =
    lastImportResult ?? await getImportStatus<TahImportResult>(IMPORT_STATUS_FONTE);

  return {
    totalRegistros: Number(countResult?.total || 0),
    comCnpjCpf: Number(withCnpj?.total || 0),
    ultimaImportacao,
  };
}
