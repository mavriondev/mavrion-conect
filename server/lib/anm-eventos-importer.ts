// Importador dos eventos de processos minerários (microdados SCM — dados
// abertos da ANM, arquivo ProcessoEvento.txt dentro de microdados-scm.zip).
//
// ATENÇÃO (memória do projeto): o WAF de dadosabertos.anm.gov.br mata streams
// fetch longos no meio, sem erro — o download do ZIP (~300 MB) é feito com
// curl para disco e a importação lê do arquivo local. Também aceita caminho
// local via env (ANM_EVENTOS_ZIP_LOCAL_FILE), no mesmo molde do CFEM.
import { spawn } from "child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface } from "readline";
import iconv from "iconv-lite";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { saveImportStatus, getImportStatus } from "./import-status";
import { ANM_BROWSER_HEADERS } from "./cfem-importer";

const ZIP_URL = "https://dadosabertos.anm.gov.br/SCM/microdados/microdados-scm.zip";
const BATCH_SIZE = 1000;
const IMPORT_STATUS_FONTE = "anm_eventos";

let _importRunning = false;
export function isAnmEventosImportRunning() { return _importRunning; }
export function setAnmEventosImportRunning(v: boolean) { _importRunning = v; }

export interface AnmEventosImportResult {
  status: string;
  totalRows: number;
  imported: number;
  errors: number;
  startedAt: string;
  finishedAt: string | null;
  dataBase?: string | null;
  errorDetails?: string;
}

export async function getLastAnmEventosImportResult(): Promise<AnmEventosImportResult | null> {
  return await getImportStatus<AnmEventosImportResult>(IMPORT_STATUS_FONTE);
}

/** "831.522/1984" | "831522/1984" | "000.022/1994" -> { numero, ano } */
export function parseDsProcesso(ds: string): { numero: number; ano: number } | null {
  const clean = String(ds || "").replace(/\s/g, "").replace(/\./g, "");
  const m = clean.match(/^0*(\d{1,6})\/(\d{4})$/);
  if (!m) return null;
  const numero = parseInt(m[1], 10);
  const ano = parseInt(m[2], 10);
  if (!numero || !ano) return null;
  return { numero, ano };
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => { stderr += String(d).slice(0, 2000); });
    p.on("error", reject);
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} saiu com código ${code}: ${stderr.slice(0, 500)}`)));
  });
}

async function downloadZip(destino: string): Promise<void> {
  console.log("[ANM Eventos] Baixando ZIP com curl (WAF mata streams fetch longos):", ZIP_URL);
  await run("curl", [
    "-sS", "--fail", "-L",
    "-A", ANM_BROWSER_HEADERS["User-Agent"],
    "-H", `Accept: ${ANM_BROWSER_HEADERS["Accept"]}`,
    "-H", `Accept-Language: ${ANM_BROWSER_HEADERS["Accept-Language"]}`,
    "--connect-timeout", "30", "--max-time", "1800",
    "-o", destino, ZIP_URL,
  ]);
  const size = statSync(destino).size;
  if (size < 10_000_000) throw new Error(`ZIP baixado suspeito de truncamento/bloqueio (${size} bytes)`);
  console.log(`[ANM Eventos] ZIP baixado: ${(size / 1e6).toFixed(0)} MB`);
}

async function extrair(zipPath: string, dir: string): Promise<{ eventosTxt: string; lookupTxt: string }> {
  await run("unzip", ["-o", "-q", zipPath, "microdados-scm/ProcessoEvento.txt", "microdados-scm/Evento.txt", "-d", dir]);
  const eventosTxt = join(dir, "microdados-scm", "ProcessoEvento.txt");
  const lookupTxt = join(dir, "microdados-scm", "Evento.txt");
  if (!existsSync(eventosTxt)) throw new Error("ProcessoEvento.txt não encontrado no ZIP");
  return { eventosTxt, lookupTxt };
}

async function carregarLookupEventos(path: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!existsSync(path)) return map;
  const rl = createInterface({ input: createReadStream(path).pipe(iconv.decodeStream("latin1")), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    const sep = line.indexOf(";");
    if (sep < 0) continue;
    const id = parseInt(line.slice(0, sep), 10);
    const desc = line.slice(sep + 1).replace(/\r$/, "").trim();
    if (Number.isFinite(id) && desc) map.set(id, desc);
  }
  console.log(`[ANM Eventos] Lookup de eventos carregado: ${map.size} tipos`);
  return map;
}

interface EventoRow {
  numero: number;
  ano: number;
  processo: string;
  idEvento: number | null;
  descricaoEvento: string | null;
  dtEvento: string | null;
  obEvento: string | null;
  publicacaoDou: string | null;
}

async function insertBatch(table: string, batch: EventoRow[]) {
  if (batch.length === 0) return;
  const values = batch.map(r => sql`(${r.numero}, ${r.ano}, ${r.processo}, ${r.idEvento}, ${r.descricaoEvento}, ${r.dtEvento}, ${r.obEvento}, ${r.publicacaoDou}, NOW())`);
  await db.execute(sql`
    INSERT INTO ${sql.raw(table)} (numero, ano, processo, id_evento, descricao_evento, dt_evento, ob_evento, publicacao_dou, importado_em)
    VALUES ${sql.join(values, sql`, `)}
  `);
}

/**
 * Importa a base completa de eventos (≈9,6M linhas). Carrega numa tabela de
 * staging e faz swap atômico no final — a base atual continua servindo
 * consultas durante toda a importação.
 */
export async function importAnmEventos(): Promise<{ totalRows: number; imported: number; errors: number; durationMs: number }> {
  const startedAt = new Date();
  await saveImportStatus(IMPORT_STATUS_FONTE, {
    status: "running", totalRows: 0, imported: 0, errors: 0,
    startedAt: startedAt.toISOString(), finishedAt: null,
  });

  let tmpDir: string | null = null;
  try {
    let zipPath = process.env.ANM_EVENTOS_ZIP_LOCAL_FILE || "";
    tmpDir = mkdtempSync(join(tmpdir(), "anm-eventos-"));
    if (zipPath) {
      console.log("[ANM Eventos] Usando ZIP local:", zipPath);
      if (!existsSync(zipPath)) throw new Error(`ANM_EVENTOS_ZIP_LOCAL_FILE não existe: ${zipPath}`);
    } else {
      zipPath = join(tmpDir, "microdados-scm.zip");
      await downloadZip(zipPath);
    }

    const { eventosTxt, lookupTxt } = await extrair(zipPath, tmpDir);
    const lookup = await carregarLookupEventos(lookupTxt);

    // staging sem índice (índice só no final, mais rápido)
    const staging = "anm_eventos_processos_stg";
    await db.execute(sql`DROP TABLE IF EXISTS ${sql.raw(staging)}`);
    await db.execute(sql`
      CREATE TABLE ${sql.raw(staging)} (
        id SERIAL PRIMARY KEY,
        numero INTEGER NOT NULL,
        ano INTEGER NOT NULL,
        processo TEXT NOT NULL,
        id_evento INTEGER,
        descricao_evento TEXT,
        dt_evento TEXT,
        ob_evento TEXT,
        publicacao_dou TEXT,
        importado_em TIMESTAMP DEFAULT now()
      )
    `);

    const rl = createInterface({ input: createReadStream(eventosTxt).pipe(iconv.decodeStream("latin1")), crlfDelay: Infinity });
    let totalRows = 0, imported = 0, errors = 0, first = true;
    let batch: EventoRow[] = [];

    for await (const line of rl) {
      if (first) { first = false; continue; }
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.trim()) continue;
      totalRows++;
      try {
        // Formato: DSProcesso;IDEvento;DTEvento;OBEvento;DSPublicacaoDOU
        // (validado: todas as linhas têm exatamente 5 campos; ainda assim,
        // campos extras são reagrupados na publicação por tolerância)
        const f = trimmed.split(";");
        const parsed = parseDsProcesso(f[0] || "");
        if (!parsed) { errors++; continue; }
        const idEvento = parseInt(f[1] || "", 10);
        const dt = (f[2] || "").trim() || null;
        const ob = (f[3] || "").trim() || null;
        const pub = f.length > 5 ? f.slice(4).join(";").trim() : (f[4] || "").trim();
        batch.push({
          numero: parsed.numero,
          ano: parsed.ano,
          processo: (f[0] || "").trim(),
          idEvento: Number.isFinite(idEvento) ? idEvento : null,
          descricaoEvento: (Number.isFinite(idEvento) && lookup.get(idEvento)) || null,
          dtEvento: dt,
          obEvento: ob,
          publicacaoDou: pub || null,
        });
        if (batch.length >= BATCH_SIZE) {
          try { await insertBatch(staging, batch); imported += batch.length; }
          catch (e: any) { console.error("[ANM Eventos] Erro no batch:", e.message); errors += batch.length; }
          batch = [];
          if (totalRows % 500_000 === 0) {
            console.log(`[ANM Eventos] Progresso: ${imported} importados / ${totalRows} linhas`);
            await saveImportStatus(IMPORT_STATUS_FONTE, {
              status: "running", totalRows, imported, errors,
              startedAt: startedAt.toISOString(), finishedAt: null,
            });
          }
        }
      } catch { errors++; }
    }
    if (batch.length > 0) {
      try { await insertBatch(staging, batch); imported += batch.length; }
      catch (e: any) { console.error("[ANM Eventos] Erro no batch final:", e.message); errors += batch.length; }
    }

    if (imported === 0) throw new Error("Nenhum evento importado — arquivo vazio ou formato mudou");

    console.log("[ANM Eventos] Criando índice na staging...");
    await db.execute(sql`CREATE INDEX idx_anm_eventos_stg ON ${sql.raw(staging)} (numero, ano)`);

    // swap atômico: a base antiga serve consultas até o último instante
    await db.transaction(async (tx) => {
      await tx.execute(sql`DROP TABLE IF EXISTS anm_eventos_processos_old`);
      await tx.execute(sql`ALTER TABLE IF EXISTS anm_eventos_processos RENAME TO anm_eventos_processos_old`);
      await tx.execute(sql`ALTER INDEX IF EXISTS idx_anm_eventos_processo RENAME TO idx_anm_eventos_processo_old`);
      await tx.execute(sql`ALTER TABLE ${sql.raw(staging)} RENAME TO anm_eventos_processos`);
      await tx.execute(sql`ALTER INDEX idx_anm_eventos_stg RENAME TO idx_anm_eventos_processo`);
      await tx.execute(sql`DROP TABLE IF EXISTS anm_eventos_processos_old`);
    });

    const dataBase = await getAnmEventosDataBase();
    const durationMs = Date.now() - startedAt.getTime();
    console.log(`[ANM Eventos] Importação concluída: ${imported} eventos em ${(durationMs / 1000).toFixed(0)}s (${errors} erros)`);
    await saveImportStatus(IMPORT_STATUS_FONTE, {
      status: "completed", totalRows, imported, errors,
      startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), dataBase,
    });
    return { totalRows, imported, errors, durationMs };
  } catch (err: any) {
    await saveImportStatus(IMPORT_STATUS_FONTE, {
      status: "error", totalRows: 0, imported: 0, errors: 0,
      startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
      errorDetails: String(err?.message || err).slice(0, 500),
    });
    throw err;
  } finally {
    if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  }
}

/** Data-base da importação (dia mais recente de evento na base local). */
export async function getAnmEventosDataBase(): Promise<string | null> {
  try {
    // a fonte tem datas futuras por erro de digitação (ex.: 2031) — a
    // data-base é o evento mais recente até hoje
    const r = await db.execute(sql`SELECT MAX(dt_evento) AS max_dt FROM anm_eventos_processos WHERE dt_evento <= to_char(CURRENT_DATE, 'YYYY-MM-DD')`);
    return (r as any).rows?.[0]?.max_dt || null;
  } catch { return null; }
}

export interface EventoProcesso {
  data: string | null;
  descricao: string;
  publicacaoDou: string | null;
}

/**
 * Consulta eventos do processo na base local (número COMPLETO: número + ano).
 * Retorna eventos ordenados do mais recente ao mais antigo, com fonte e
 * data-base para citação na seção do relatório.
 */
export async function getEventosByProcesso(processo: string): Promise<{
  eventos: EventoProcesso[];
  total: number;
  fonte: string | null;
  dataBase: string | null;
}> {
  const parsed = parseDsProcesso(processo);
  if (!parsed) return { eventos: [], total: 0, fonte: null, dataBase: null };
  try {
    const r = await db.execute(sql`
      SELECT dt_evento, descricao_evento, ob_evento, publicacao_dou
      FROM anm_eventos_processos
      WHERE numero = ${parsed.numero} AND ano = ${parsed.ano}
      ORDER BY dt_evento DESC NULLS LAST, id DESC
    `);
    const rows: any[] = (r as any).rows || [];
    if (rows.length === 0) return { eventos: [], total: 0, fonte: null, dataBase: null };
    const eventos: EventoProcesso[] = rows.map((row) => {
      const partes = [row.descricao_evento, row.ob_evento && row.ob_evento !== "CARGA SICOM" && row.ob_evento !== row.descricao_evento ? row.ob_evento : null]
        .filter(Boolean).map((s: any) => String(s).trim());
      return {
        data: row.dt_evento || null,
        descricao: (partes.join(" — ") || String(row.ob_evento || "").trim()).slice(0, 400),
        publicacaoDou: row.publicacao_dou ? String(row.publicacao_dou).slice(0, 400) : null,
      };
    }).filter((e) => e.descricao || e.data);
    const dataBase = await getAnmEventosDataBase();
    return {
      eventos,
      total: eventos.length,
      fonte: `Dados abertos ANM — microdados SCM (eventos de processos)${dataBase ? `, base de ${dataBase}` : ""}`,
      dataBase,
    };
  } catch (e: any) {
    console.error("[ANM Eventos] Erro na consulta:", e.message);
    return { eventos: [], total: 0, fonte: null, dataBase: null };
  }
}

export async function getAnmEventosStats() {
  let totalRegistros = 0, processosDistintos = 0;
  try {
    const r = await db.execute(sql`SELECT COUNT(*) AS total, COUNT(DISTINCT (numero, ano)) AS procs FROM anm_eventos_processos`);
    totalRegistros = Number((r as any).rows?.[0]?.total || 0);
    processosDistintos = Number((r as any).rows?.[0]?.procs || 0);
  } catch {}
  return {
    totalRegistros,
    processosDistintos,
    dataBase: await getAnmEventosDataBase(),
    ultimaImportacao: await getLastAnmEventosImportResult(),
  };
}
