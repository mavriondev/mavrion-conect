import OpenAI from "openai";
import * as zlib from "zlib";
import { db } from "../db";
import { assetDocumentTexts } from "@shared/schema";
import { and, eq } from "drizzle-orm";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

const VISION_MODEL = "gpt-5.4-mini";
const MAX_TEXTO_CHARS = 60_000;
const MIN_PDF_TEXT_CHARS = 120; // abaixo disso, tratamos como PDF escaneado e usamos visão
const MAX_VISION_FILE_BYTES = 20 * 1024 * 1024;

const VISION_INSTRUCTION = `Transcreva integralmente o texto legível deste documento, em português. Preserve títulos, datas, números de processo, nomes e valores. Se houver tabelas, converta para texto estruturado. Se partes estiverem ilegíveis, indique [ilegível]. Não invente conteúdo. Responda APENAS com a transcrição.`;

export interface ExtractParams {
  orgId: number;
  assetId: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return (result.text || "").trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

const MAX_EXCEL_FILE_BYTES = 10 * 1024 * 1024; // limite de entrada específico p/ planilhas
const MAX_EXCEL_ROWS_PER_SHEET = 5_000;
const MAX_EXCEL_COLS = 100;
const MAX_CELL_CHARS = 500;
const MAX_ROW_CHARS = 4_000;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // proteção contra zip bomb

/**
 * Validação pré-parse de um .xlsx (container ZIP): rejeita arquivos com
 * diretório corrompido, entradas demais ou expansão descompactada excessiva,
 * ANTES de entregar o buffer ao parser (proteção contra zip bombs).
 *
 * Não confia nos tamanhos declarados nos cabeçalhos (controlados pelo
 * atacante): descompacta de fato cada entrada DEFLATE com limite rígido de
 * saída (`maxOutputLength`), abortando na primeira que estourar o orçamento.
 * Retorna mensagem de erro ou null se ok.
 */
export function validarZipExcel(buffer: Buffer): string | null {
  // localizar End of Central Directory (assinatura 0x06054b50)
  const scanStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= scanStart; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return "Arquivo .xlsx inválido (estrutura ZIP corrompida)";
  const entryCount = buffer.readUInt16LE(eocd + 10);
  if (entryCount > MAX_ZIP_ENTRIES) return "Planilha rejeitada: número excessivo de entradas internas";
  let off = buffer.readUInt32LE(eocd + 16);
  let orcamentoRestante = MAX_ZIP_UNCOMPRESSED_BYTES;
  const erroBomba = "Planilha rejeitada: conteúdo descompactado grande demais (possível zip bomb)";
  for (let n = 0; n < entryCount; n++) {
    if (off + 46 > buffer.length || buffer.readUInt32LE(off) !== 0x02014b50) {
      return "Arquivo .xlsx inválido (diretório ZIP corrompido)";
    }
    const metodo = buffer.readUInt16LE(off + 10);
    const compressedSize = buffer.readUInt32LE(off + 20);
    const localOffset = buffer.readUInt32LE(off + 42);
    // localizar início real dos dados via cabeçalho local
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      return "Arquivo .xlsx inválido (cabeçalho local corrompido)";
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = Math.min(dataStart + compressedSize, buffer.length);
    if (dataStart > buffer.length) return "Arquivo .xlsx inválido (dados fora do arquivo)";

    if (metodo === 0) {
      // armazenado sem compressão: o tamanho real é o próprio compressedSize
      orcamentoRestante -= dataEnd - dataStart;
      if (orcamentoRestante < 0) return erroBomba;
    } else if (metodo === 8) {
      // DEFLATE: descompactar de verdade com limite rígido de saída
      try {
        const saida = zlib.inflateRawSync(buffer.subarray(dataStart, dataEnd), {
          maxOutputLength: orcamentoRestante,
        });
        orcamentoRestante -= saida.length;
      } catch (e: any) {
        if (e?.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|output length/i.test(String(e?.message))) {
          return erroBomba;
        }
        return "Arquivo .xlsx inválido (entrada compactada corrompida)";
      }
    } else {
      return "Planilha rejeitada: método de compressão não suportado";
    }
    off += 46 + buffer.readUInt16LE(off + 28) + buffer.readUInt16LE(off + 30) + buffer.readUInt16LE(off + 32);
  }
  return null;
}

export async function extractExcelText(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_EXCEL_FILE_BYTES) {
    throw new Error("Planilha grande demais para leitura pela IA (>10MB)");
  }
  // .xlsx = container ZIP (assinatura "PK") — validar antes de parsear
  if (buffer.length >= 4 && buffer.readUInt16LE(0) === 0x4b50) {
    const erroZip = validarZipExcel(buffer);
    if (erroZip) throw new Error(erroZip);
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    dense: true,
    sheetRows: MAX_EXCEL_ROWS_PER_SHEET, // limita linhas já na leitura
    cellHTML: false,
    cellFormula: false,
  });
  const partes: string[] = [];
  let total = 0;
  for (const sheetName of workbook.SheetNames) {
    if (total >= MAX_TEXTO_CHARS) break;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    });
    const linhas: string[] = [];
    let sheetChars = 0;
    for (const row of rows) {
      const celulas: string[] = [];
      let rowChars = 0;
      for (const c of row.slice(0, MAX_EXCEL_COLS)) {
        // cortar a célula ANTES de escapar, para uma célula gigante não estourar o orçamento
        let s = String(c ?? "");
        if (s.length > MAX_CELL_CHARS) s = s.slice(0, MAX_CELL_CHARS) + "…";
        if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
        celulas.push(s);
        rowChars += s.length + 1;
        if (rowChars >= MAX_ROW_CHARS) break;
      }
      const linha = celulas.join(",");
      if (!linha.replace(/,/g, "").trim()) continue;
      linhas.push(linha);
      sheetChars += linha.length + 1;
      if (total + sheetChars >= MAX_TEXTO_CHARS) break; // truncamento incremental
    }
    if (linhas.length === 0) continue;
    const bloco = `=== Aba: ${sheetName} ===\n${linhas.join("\n")}`;
    partes.push(bloco);
    total += bloco.length + 2;
  }
  return partes.join("\n\n").trim();
}

async function extractWordText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return (result.value || "").trim();
}

async function visionTranscribeImage(buffer: Buffer, mimeType: string): Promise<string> {
  const b64 = buffer.toString("base64");
  const response = await getOpenAI().chat.completions.create({
    model: VISION_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: VISION_INSTRUCTION },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
      ],
    }],
    max_completion_tokens: 8000,
  });
  return (response.choices[0]?.message?.content || "").trim();
}

async function visionTranscribePdf(buffer: Buffer, fileName: string): Promise<string> {
  const b64 = buffer.toString("base64");
  const response = await getOpenAI().responses.create({
    model: VISION_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_file", filename: fileName, file_data: `data:application/pdf;base64,${b64}` },
        { type: "input_text", text: VISION_INSTRUCTION },
      ],
    }],
    max_output_tokens: 8000,
  });
  return (response.output_text || "").trim();
}

async function upsertRow(params: {
  orgId: number; assetId: number; fileId: string; fileName: string; mimeType: string | null;
  status: string; metodo?: string | null; texto?: string | null; erro?: string | null;
}) {
  await db.insert(assetDocumentTexts)
    .values({
      orgId: params.orgId,
      assetId: params.assetId,
      fileId: params.fileId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      status: params.status,
      metodo: params.metodo ?? null,
      texto: params.texto ?? null,
      erro: params.erro ?? null,
    })
    .onConflictDoUpdate({
      target: assetDocumentTexts.fileId,
      set: {
        orgId: params.orgId,
        assetId: params.assetId,
        fileName: params.fileName,
        mimeType: params.mimeType,
        status: params.status,
        metodo: params.metodo ?? null,
        texto: params.texto ?? null,
        erro: params.erro ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Extrai o texto de um documento anexado a um ativo e persiste o resultado.
 * Best-effort: nunca lança — erros são registrados na linha com status "erro".
 */
export async function extractDocumentText(params: ExtractParams): Promise<void> {
  const { orgId, assetId, fileId, fileName, mimeType, buffer } = params;
  try {
    await upsertRow({ orgId, assetId, fileId, fileName, mimeType, status: "processando" });

    let texto = "";
    let metodo = "";

    if (mimeType === "application/pdf") {
      try {
        texto = await extractPdfText(buffer);
        metodo = "pdf";
      } catch (e: any) {
        console.warn(`[DocExtract] pdf-parse falhou para ${fileName}: ${e.message}`);
        texto = "";
      }
      if (texto.length < MIN_PDF_TEXT_CHARS) {
        // PDF escaneado (caso típico do DOU) — usar visão
        if (buffer.length > MAX_VISION_FILE_BYTES) {
          await upsertRow({
            orgId, assetId, fileId, fileName, mimeType, status: "sem_texto", metodo: "pdf",
            erro: "PDF sem texto extraível e grande demais para leitura por visão (>20MB)",
          });
          return;
        }
        texto = await visionTranscribePdf(buffer, fileName);
        metodo = "visao_pdf";
      }
    } else if (mimeType.startsWith("image/")) {
      if (buffer.length > MAX_VISION_FILE_BYTES) {
        await upsertRow({
          orgId, assetId, fileId, fileName, mimeType, status: "sem_texto",
          erro: "Imagem grande demais para leitura por visão (>20MB)",
        });
        return;
      }
      texto = await visionTranscribeImage(buffer, mimeType);
      metodo = "visao";
    } else if (
      mimeType === "application/msword" ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      texto = await extractWordText(buffer);
      metodo = "word";
    } else if (
      mimeType === "application/vnd.ms-excel" ||
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
      texto = await extractExcelText(buffer);
      metodo = "excel";
    } else if (mimeType === "text/plain") {
      texto = buffer.toString("utf-8").trim();
      metodo = "txt";
    } else {
      await upsertRow({
        orgId, assetId, fileId, fileName, mimeType, status: "sem_texto",
        erro: "Tipo de arquivo não suportado para leitura pela IA",
      });
      return;
    }

    if (!texto || texto.length < 5) {
      await upsertRow({ orgId, assetId, fileId, fileName, mimeType, status: "sem_texto", metodo });
      return;
    }

    if (texto.length > MAX_TEXTO_CHARS) {
      texto = texto.slice(0, MAX_TEXTO_CHARS) + "\n[... texto truncado ...]";
    }

    await upsertRow({ orgId, assetId, fileId, fileName, mimeType, status: "concluido", metodo, texto });
    console.log(`[DocExtract] ${fileName} lido (${metodo}, ${texto.length} chars)`);
  } catch (err: any) {
    console.error(`[DocExtract] Erro ao extrair ${fileName}:`, err.message);
    try {
      await upsertRow({
        orgId, assetId, fileId, fileName, mimeType, status: "erro",
        erro: (err.message || "Erro desconhecido").slice(0, 500),
      });
    } catch { }
  }
}

/**
 * Dispara a extração em segundo plano, sem bloquear o fluxo chamador.
 * Limita a concorrência para uploads em lote não saturarem o processo.
 */
const MAX_CONCURRENT_EXTRACTIONS = 2;
let extracoesAtivas = 0;
const filaExtracao: Array<() => Promise<void>> = [];

/**
 * Agenda um trabalho de extração respeitando o limite de concorrência.
 * A vaga é reservada de forma SÍNCRONA, então várias chamadas no mesmo tick
 * também contam contra o limite. Exportado para teste.
 */
export function agendarExtracao(job: () => Promise<void>): void {
  if (extracoesAtivas < MAX_CONCURRENT_EXTRACTIONS) {
    extracoesAtivas++; // reserva a vaga antes de agendar
    setImmediate(() => executarExtracao(job));
  } else {
    filaExtracao.push(job);
  }
}

function executarExtracao(job: () => Promise<void>): void {
  job()
    .catch(() => {})
    .finally(() => {
      const next = filaExtracao.shift();
      if (next) {
        setImmediate(() => executarExtracao(next)); // mantém a vaga ocupada
      } else {
        extracoesAtivas--;
      }
    });
}

export function extractDocumentTextAsync(params: ExtractParams): void {
  agendarExtracao(() =>
    extractDocumentText(params).catch((e) =>
      console.error(`[DocExtract] Falha inesperada (${params.fileName}):`, e?.message)
    )
  );
}

/** Lista o status de extração dos documentos de um ativo (sem o texto completo). */
export async function listarTextosAtivo(assetId: number, orgId: number) {
  const rows = await db.select({
    id: assetDocumentTexts.id,
    fileId: assetDocumentTexts.fileId,
    fileName: assetDocumentTexts.fileName,
    mimeType: assetDocumentTexts.mimeType,
    status: assetDocumentTexts.status,
    metodo: assetDocumentTexts.metodo,
    erro: assetDocumentTexts.erro,
    updatedAt: assetDocumentTexts.updatedAt,
    texto: assetDocumentTexts.texto,
  }).from(assetDocumentTexts)
    .where(and(eq(assetDocumentTexts.assetId, assetId), eq(assetDocumentTexts.orgId, orgId)));

  return rows.map(r => ({
    id: r.id,
    fileId: r.fileId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    status: r.status,
    metodo: r.metodo,
    erro: r.erro,
    updatedAt: r.updatedAt,
    textoChars: r.texto ? r.texto.length : 0,
  }));
}

/** Retorna os documentos com texto extraído de um ativo (para injeção no prompt de IA). */
export async function getTextosParaIA(assetId: number, orgId: number): Promise<Array<{ fileName: string; texto: string }>> {
  const rows = await db.select({
    fileName: assetDocumentTexts.fileName,
    texto: assetDocumentTexts.texto,
  }).from(assetDocumentTexts)
    .where(and(
      eq(assetDocumentTexts.assetId, assetId),
      eq(assetDocumentTexts.orgId, orgId),
      eq(assetDocumentTexts.status, "concluido"),
    ));
  return rows.filter(r => r.texto && r.texto.trim().length > 0) as Array<{ fileName: string; texto: string }>;
}
