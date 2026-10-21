// Importador do extrato público de barragens de mineração (SIGBM/ANM).
// Arquivo pequeno (~3,4MB, ~900 barragens) — baixa inteiro, parseia e regrava.
// Coordenadas vêm em DMS (-09°54'04.000'') e precisam de conversão para decimal.
import { db } from "../db";
import { sigbmBarragens } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import iconv from "iconv-lite";
import { ANM_BROWSER_HEADERS } from "./cfem-importer";
import { saveImportStatus, getImportStatus } from "./import-status";
import { payloadFalhaConsulta, type IdentificadorVinculo } from "./consulta-contrato";

const SIGBM_CSV_URL = "https://dadosabertos.anm.gov.br/SIGBM/Barragens.csv";

let _importRunning = false;
let _importPromise: Promise<{ imported: number }> | null = null;

interface SigbmImportResult {
  status: string;
  imported: number;
  errors: number;
  startedAt: Date;
  finishedAt: Date | null;
  errorDetails?: string;
}

const IMPORT_STATUS_FONTE = "sigbm";

let lastImportResult: SigbmImportResult | null = null;

export function getLastSigbmImportResult() { return lastImportResult; }
export function isSigbmImportRunning() { return _importRunning; }

// Converte "-09°54'04.000''" (DMS) para decimal; aceita também decimal com vírgula.
export function parseDmsToDecimal(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "-") return null;
  const dms = s.match(/^(-?)\s*(\d{1,3})°\s*(\d{1,2})'\s*([\d.,]+)''?/);
  if (dms) {
    const sign = dms[1] === "-" ? -1 : 1;
    const deg = parseInt(dms[2], 10);
    const min = parseInt(dms[3], 10);
    const sec = parseFloat(dms[4].replace(",", "."));
    if (isNaN(deg) || isNaN(min) || isNaN(sec)) return null;
    return sign * (deg + min / 60 + sec / 3600);
  }
  const dec = parseFloat(s.replace(",", "."));
  return isNaN(dec) ? null : dec;
}

function parseDecimalBr(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const cleaned = val.trim().replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Parser CSV completo (campos entre aspas, aspas duplicadas); linha a linha.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current.trim()); current = ""; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        fields.push(current.trim()); current = "";
        if (fields.length > 1 || fields[0] !== "") rows.push(fields);
        fields = [];
      } else current += ch;
    }
  }
  if (current !== "" || fields.length > 0) { fields.push(current.trim()); rows.push(fields); }
  return rows;
}

export async function importSigbmCsv(): Promise<{ imported: number }> {
  if (_importPromise) return _importPromise;
  _importRunning = true;
  const startedAt = new Date();
  lastImportResult = { status: "running", imported: 0, errors: 0, startedAt, finishedAt: null };

  _importPromise = (async () => {
    try {
      // Persiste o "running" ANTES de qualquer trabalho: se o processo cair no
      // meio (delete+insert parciais deixam importado_em novo!), o marcador
      // órfão impede que getSigbmStats sintetize um "completed" falso, e a
      // reconciliação do painel de saúde converte a rodada em erro.
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      console.log("[SIGBM] Baixando extrato de barragens:", SIGBM_CSV_URL);
      const resp = await fetch(SIGBM_CSV_URL, { headers: ANM_BROWSER_HEADERS, signal: AbortSignal.timeout(120000) });
      if (!resp.ok) throw new Error(`Download falhou: HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const text = iconv.decode(buf, "latin1");
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV vazio ou inválido");

      const hdr = rows[0];
      const idx = (name: string) => hdr.findIndex(h => h === name);
      const col = {
        id: idx("ID"), nome: idx("Nome"), empreendedor: idx("Empreendedor"),
        cpfCnpj: idx("CPF_CNPJ"), nomeMina: idx("Nome da mina"), uf: idx("UF"),
        municipio: idx("Município"), lat: idx("Latitude"), lon: idx("Longitude"),
        cri: idx("Categoria de Risco - CRI"), dpa: idx("Dano Potencial Associado - DPA"),
        paebm: idx("Necessita de PAEBM"), pnsb: idx("Inserido na PNSB"),
        emergencia: idx("Nível de Emergência"), situacao: idx("Situação Operacional"),
        minerio: idx("Minério principal presente no reservatório"),
        altura: idx("Altura máxima atual (m)"), volume: idx("Volume atual do Reservatório (m³)"),
        pessoas: hdr.findIndex(h => h.startsWith("Número de pessoas possivelmente afetadas")),
      };
      if (col.id < 0 || col.nome < 0) throw new Error("Cabeçalho inesperado no CSV do SIGBM");

      const get = (r: string[], i: number) => (i >= 0 && r[i] != null ? r[i].trim() : "");
      const values = rows.slice(1)
        .map(r => {
          const idAnm = parseInt(get(r, col.id), 10);
          if (!idAnm) return null;
          return {
            idAnm,
            nome: get(r, col.nome) || null,
            empreendedor: get(r, col.empreendedor) || null,
            cpfCnpj: get(r, col.cpfCnpj).replace(/\D/g, "") || null,
            nomeMina: get(r, col.nomeMina) || null,
            uf: get(r, col.uf) || null,
            municipio: get(r, col.municipio) || null,
            latitude: parseDmsToDecimal(get(r, col.lat)),
            longitude: parseDmsToDecimal(get(r, col.lon)),
            categoriaRisco: get(r, col.cri) || null,
            danoPotencial: get(r, col.dpa) || null,
            necessitaPaebm: get(r, col.paebm) || null,
            inseridaPnsb: get(r, col.pnsb) || null,
            nivelEmergencia: get(r, col.emergencia) || null,
            situacaoOperacional: get(r, col.situacao) || null,
            minerioPrincipal: get(r, col.minerio) || null,
            alturaAtual: parseDecimalBr(get(r, col.altura)),
            volumeAtual: parseDecimalBr(get(r, col.volume)),
            pessoasAfetadas: get(r, col.pessoas) || null,
            importadoEm: new Date(),
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      await db.delete(sigbmBarragens);
      for (let i = 0; i < values.length; i += 200) {
        await db.insert(sigbmBarragens).values(values.slice(i, i + 200))
          .onConflictDoNothing({ target: sigbmBarragens.idAnm });
      }

      console.log(`[SIGBM] Importação concluída: ${values.length} barragens`);
      lastImportResult = { status: "completed", imported: values.length, errors: 0, startedAt, finishedAt: new Date() };
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      return { imported: values.length };
    } catch (e: any) {
      console.error("[SIGBM] Erro na importação:", e.message);
      lastImportResult = { status: "error", imported: 0, errors: 1, startedAt, finishedAt: new Date(), errorDetails: e.message };
      await saveImportStatus(IMPORT_STATUS_FONTE, lastImportResult);
      throw e;
    } finally {
      _importRunning = false;
      _importPromise = null;
    }
  })();
  return _importPromise;
}

export async function getSigbmStats() {
  const [c] = await db.select({
    total: sql<number>`COUNT(*)`,
    ultima: sql<string>`MAX(${sigbmBarragens.importadoEm})`,
  }).from(sigbmBarragens);
  // Resultado persistente da última importação (sobrevive a restart). Se a
  // tabela tiver dados mais novos que o status (carga externa ou base anterior
  // à tabela de status), deriva de MAX(importado_em) — exceto durante uma
  // importação em andamento.
  let persisted = lastImportResult ?? await getImportStatus<SigbmImportResult>(IMPORT_STATUS_FONTE);
  const baseAtualizadaEm = c?.ultima && Number(c?.total || 0) > 0 ? new Date(c.ultima) : null;
  const statusRef = persisted?.finishedAt ? new Date(persisted.finishedAt) : null;
  if (baseAtualizadaEm && persisted?.status !== "running" &&
      (!statusRef || baseAtualizadaEm.getTime() > statusRef.getTime())) {
    persisted = {
      status: "completed", imported: Number(c!.total), errors: 0,
      startedAt: baseAtualizadaEm, finishedAt: baseAtualizadaEm,
    };
  }
  return {
    totalBarragens: Number(c?.total || 0),
    ultimaImportacao: c?.ultima || null,
    importRunning: _importRunning,
    lastImportResult: persisted,
  };
}

// Garante base populada (importa na primeira consulta — arquivo pequeno).
export async function ensureSigbmData(): Promise<boolean> {
  const stats = await getSigbmStats();
  if (stats.totalBarragens > 0) return true;
  try {
    await importSigbmCsv();
    return true;
  } catch {
    return false;
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const publicShape = (b: typeof sigbmBarragens.$inferSelect, distanciaKm?: number) => ({
  idAnm: b.idAnm,
  nome: b.nome,
  empreendedor: b.empreendedor,
  cpfCnpj: b.cpfCnpj,
  nomeMina: b.nomeMina,
  uf: b.uf,
  municipio: b.municipio,
  latitude: b.latitude,
  longitude: b.longitude,
  categoriaRisco: b.categoriaRisco,
  danoPotencial: b.danoPotencial,
  necessitaPaebm: b.necessitaPaebm,
  inseridaPnsb: b.inseridaPnsb,
  nivelEmergencia: b.nivelEmergencia,
  situacaoOperacional: b.situacaoOperacional,
  minerioPrincipal: b.minerioPrincipal,
  alturaAtual: b.alturaAtual,
  volumeAtual: b.volumeAtual,
  pessoasAfetadas: b.pessoasAfetadas,
  ...(distanciaKm != null ? { distanciaKm: Math.round(distanciaKm * 10) / 10 } : {}),
});

export async function consultarBarragens(opts: {
  cnpj?: string;
  nomeTitular?: string;
  lat?: number;
  lon?: number;
  raioKm?: number;
}) {
  const cnpjDigits = (opts.cnpj || "").replace(/\D/g, "");
  const nomeBusca = (opts.nomeTitular || "").trim();
  const identificadorBusca: IdentificadorVinculo | null = cnpjDigits.length === 14
    ? { tipo: "cnpj", valor: cnpjDigits, proveniencia: "desconhecida" }
    : (nomeBusca.length >= 5 ? { tipo: "nome", valor: nomeBusca, proveniencia: "desconhecida" } : null);
  const ok = await ensureSigbmData();
  if (!ok) {
    return payloadFalhaConsulta({
      fonte: "SIGBM/ANM — extrato público de barragens de mineração",
      tierFonte: "T1",
      motivoFalha: "Base SIGBM indisponível no momento (falha ao baixar o extrato da ANM)",
      identificadorVinculo: identificadorBusca,
    });
  }

  type BarragemTitular = ReturnType<typeof publicShape> & {
    vinculo: { por: "cnpj" | "nome_empreendedor"; termo: string; confirmado: boolean };
  };
  const doTitular: BarragemTitular[] = [];
  let matchPor: "cnpj" | "nome_empreendedor" | null = null;
  if (cnpjDigits.length === 14) {
    const rows = await db.select().from(sigbmBarragens).where(eq(sigbmBarragens.cpfCnpj, cnpjDigits));
    doTitular.push(...rows.map(r => ({
      ...publicShape(r),
      vinculo: { por: "cnpj" as const, termo: cnpjDigits, confirmado: true },
    })));
    if (doTitular.length > 0) matchPor = "cnpj";
  }
  if (doTitular.length === 0 && opts.nomeTitular && opts.nomeTitular.trim().length >= 5) {
    const nome = `%${opts.nomeTitular.trim().toUpperCase()}%`;
    const rows = await db.select().from(sigbmBarragens)
      .where(sql`UPPER(${sigbmBarragens.empreendedor}) LIKE ${nome}`)
      .limit(50);
    // casamento só por nome do empreendedor (LIKE) — vinculação não confirmada:
    // exibir rotulado, sem derivar fato/alerta do titular
    doTitular.push(...rows.map(r => ({
      ...publicShape(r),
      vinculo: { por: "nome_empreendedor" as const, termo: opts.nomeTitular!.trim(), confirmado: false },
    })));
    if (doTitular.length > 0) matchPor = "nome_empreendedor";
  }

  let proximas: ReturnType<typeof publicShape>[] = [];
  const raioKm = opts.raioKm || 50;
  if (opts.lat != null && opts.lon != null) {
    // ~900 barragens: filtra por bounding box no SQL e refina com haversine
    const degLat = raioKm / 111;
    const degLon = raioKm / (111 * Math.max(0.2, Math.cos(opts.lat * Math.PI / 180)));
    const rows = await db.select().from(sigbmBarragens)
      .where(sql`${sigbmBarragens.latitude} BETWEEN ${opts.lat - degLat} AND ${opts.lat + degLat}
        AND ${sigbmBarragens.longitude} BETWEEN ${opts.lon - degLon} AND ${opts.lon + degLon}`);
    proximas = rows
      .map(r => ({ r, d: haversineKm(opts.lat!, opts.lon!, r.latitude!, r.longitude!) }))
      .filter(x => x.d <= raioKm)
      .sort((a, b) => a.d - b.d)
      .slice(0, 30)
      .map(x => publicShape(x.r, x.d));
  }

  const stats = await getSigbmStats();
  const vinculoNaoConfirmado = matchPor === "nome_empreendedor";
  // identificador que efetivamente casou (ou o que foi buscado, se nada casou)
  const identificadorVinculo: IdentificadorVinculo | null = matchPor === "nome_empreendedor"
    ? { tipo: "nome", valor: nomeBusca, proveniencia: "desconhecida", origem: "empreendedor SIGBM (LIKE)" }
    : identificadorBusca;
  return {
    disponivel: true as const,
    identificadorVinculo,
    vinculoConfirmado: matchPor === "cnpj" ? true : (matchPor === "nome_empreendedor" ? false : null),
    estadoConsulta: (doTitular.length > 0 && !vinculoNaoConfirmado) || proximas.length > 0
      ? ("registro_existente" as const)
      : ("consultada_sem_registro" as const),
    // extrato cadastral do SIGBM não classifica situação — registro vigente = indeterminada
    situacaoRegistro: (doTitular.length > 0 && !vinculoNaoConfirmado) || proximas.length > 0
      ? ("indeterminada" as const)
      : null,
    tierFonte: vinculoNaoConfirmado ? ("T3" as const) : ("T1" as const),
    ...(vinculoNaoConfirmado ? {
      tierFonteOriginal: "T1" as const,
      rebaixadoMotivo: "barragens casadas apenas pelo nome do empreendedor (LIKE) — vinculação não confirmada por CNPJ",
      notaVinculo: `${doTitular.length} barragem(ns) casada(s) apenas pelo nome do empreendedor — vinculação não confirmada: exibidas rotuladas, sem virar fato do titular.`,
    } : {}),
    matchPor,
    janelaCobertura: stats.ultimaImportacao
      ? `extrato SIGBM importado em ${new Date(stats.ultimaImportacao).toLocaleDateString("pt-BR")}`
      : null,
    doTitular,
    proximas,
    raioKm,
    totalBase: stats.totalBarragens,
    fonte: "SIGBM/ANM — extrato público de barragens de mineração",
    consultadoEm: new Date().toISOString(),
  };
}
