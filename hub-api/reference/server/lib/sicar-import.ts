import { pool } from "../db";

const WFS_BASE = "https://geoserver.car.gov.br/geoserver/sicar/wfs";
const IBGE_API = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";
const BATCH_SIZE = 50;
const PAGE_SIZE = 2000;
const RATE_LIMIT_MS = 1500;
const MAX_RETRIES = 3;

interface QueueItem {
  uf: string;
  municipio?: string;
  status: "pending" | "running" | "done" | "error";
  logId?: number;
}

interface QueueProgress {
  running: boolean;
  currentUf: string | null;
  currentMunicipio: string | null;
  municipiosProcessados: number;
  municipiosTotal: number;
  imoveisImportados: number;
  municipioAtualImoveis: number;
  ultimoMunicipioCount: number;
  erros: number;
  fila: string[];
  iniciadoEm: string | null;
}

let importQueue: QueueItem[] = [];
let isProcessing = false;
let currentProgress: QueueProgress = {
  running: false,
  currentUf: null,
  currentMunicipio: null,
  municipiosProcessados: 0,
  municipiosTotal: 0,
  imoveisImportados: 0,
  municipioAtualImoveis: 0,
  ultimoMunicipioCount: 0,
  erros: 0,
  fila: [],
  iniciadoEm: null,
};

function toTitleCase(str: string): string {
  const lowercaseWords = new Set([
    "de", "da", "do", "das", "dos", "e", "em", "com", "para", "por",
  ]);
  return str
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i === 0 || !lowercaseWords.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word
    )
    .join(" ");
}

function normalizeString(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Resposta não é JSON válido: ${text.substring(0, 200)}`);
      }
    } catch (error: any) {
      if (attempt === retries) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`SICAR fetch tentativa ${attempt}/${retries} falhou: ${error.message}. Retry em ${delay}ms`);
      await sleep(delay);
    }
  }
}

async function getMunicipios(uf: string): Promise<string[]> {
  const url = `${IBGE_API}/${uf.toUpperCase()}/municipios`;
  const data = await fetchWithRetry(url);
  return data.map((m: any) => m.nome as string).sort();
}

async function fetchWfsPage(uf: string, municipio: string, startIndex: number): Promise<any> {
  const typeName = `sicar:sicar_imoveis_${uf.toLowerCase()}`;
  const cqlFilter = `municipio='${municipio.replace(/'/g, "''")}'`;

  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName,
    outputFormat: "application/json",
    CQL_FILTER: cqlFilter,
    count: String(PAGE_SIZE),
    startIndex: String(startIndex),
  });

  return fetchWithRetry(`${WFS_BASE}?${params.toString()}`);
}

async function upsertBatch(features: any[], uf: string, municipio: string): Promise<number> {
  if (features.length === 0) return 0;

  let inserted = 0;
  for (const feature of features) {
    const props = feature.properties || {};
    const codImovel = props.cod_imovel || props.COD_IMOVEL || "";
    if (!codImovel) continue;

    const numArea = parseFloat(props.area || props.num_area || props.NUM_AREA || "0") || null;
    const indStatus = props.status_imovel || props.ind_status || props.IND_STATUS || null;
    const indTipo = props.tipo_imovel || props.ind_tipo || props.IND_TIPO || null;
    const datCriacao = props.dat_criacao || null;
    const dataAtualizacao = props.data_atualizacao || null;
    const condicao = props.condicao || null;
    const codMunicipioIbge = parseInt(props.cod_municipio_ibge) || null;
    const mFiscal = parseFloat(props.m_fiscal) || null;
    const geometryJson = feature.geometry ? JSON.stringify(feature.geometry) : null;
    const propsJson = JSON.stringify(props);

    try {
      await pool.query(
        `INSERT INTO sicar_imoveis_cache
           (cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
            dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal,
            geometry, properties, geom)
         VALUES ($1, $2, $3, $4, $5, $6,
            $9::timestamp, $10::timestamp, $11, $12, $13,
            $7::jsonb, $8::jsonb,
           CASE
             WHEN $7::jsonb IS NOT NULL AND ($7::jsonb)->>'type' IS NOT NULL
             THEN ST_SetSRID(ST_GeomFromGeoJSON($7::text), 4326)
             ELSE NULL
           END
         )
         ON CONFLICT (cod_imovel) DO UPDATE SET
           uf = EXCLUDED.uf,
           municipio = EXCLUDED.municipio,
           num_area = EXCLUDED.num_area,
           ind_status = EXCLUDED.ind_status,
           ind_tipo = EXCLUDED.ind_tipo,
           dat_criacao = EXCLUDED.dat_criacao,
           data_atualizacao = EXCLUDED.data_atualizacao,
           condicao = EXCLUDED.condicao,
           cod_municipio_ibge = EXCLUDED.cod_municipio_ibge,
           m_fiscal = EXCLUDED.m_fiscal,
           geometry = EXCLUDED.geometry,
           properties = EXCLUDED.properties,
           geom = EXCLUDED.geom,
           fetched_at = CURRENT_TIMESTAMP`,
        [codImovel, uf.toUpperCase(), toTitleCase(municipio), numArea, indStatus, indTipo,
         geometryJson, propsJson, datCriacao, dataAtualizacao, condicao, codMunicipioIbge, mFiscal]
      );
      inserted++;
    } catch (err: any) {
      if (err.message?.includes("geometry") || err.message?.includes("GEOS") || err.message?.includes("Topology")) {
        try {
          await pool.query(
            `INSERT INTO sicar_imoveis_cache
               (cod_imovel, uf, municipio, num_area, ind_status, ind_tipo,
                dat_criacao, data_atualizacao, condicao, cod_municipio_ibge, m_fiscal,
                geometry, properties, geom)
             VALUES ($1, $2, $3, $4, $5, $6,
                $9::timestamp, $10::timestamp, $11, $12, $13,
                $7::jsonb, $8::jsonb, NULL)
             ON CONFLICT (cod_imovel) DO UPDATE SET
               uf = EXCLUDED.uf, municipio = EXCLUDED.municipio, num_area = EXCLUDED.num_area,
               ind_status = EXCLUDED.ind_status, ind_tipo = EXCLUDED.ind_tipo,
               dat_criacao = EXCLUDED.dat_criacao, data_atualizacao = EXCLUDED.data_atualizacao,
               condicao = EXCLUDED.condicao, cod_municipio_ibge = EXCLUDED.cod_municipio_ibge,
               m_fiscal = EXCLUDED.m_fiscal,
               geometry = EXCLUDED.geometry, properties = EXCLUDED.properties,
               geom = NULL, fetched_at = CURRENT_TIMESTAMP`,
            [codImovel, uf.toUpperCase(), toTitleCase(municipio), numArea, indStatus, indTipo,
             geometryJson, propsJson, datCriacao, dataAtualizacao, condicao, codMunicipioIbge, mFiscal]
          );
          inserted++;
          console.warn(`[SICAR Import] Geometria invalida para ${codImovel}, salvando sem geom`);
        } catch (e2: any) {
          console.error(`[SICAR Import] Falha total para ${codImovel}: ${e2.message}`);
        }
      } else {
        console.error(`[SICAR Import] Erro no upsert de ${codImovel}: ${err.message}`);
      }
    }
  }

  currentProgress.municipioAtualImoveis += inserted;
  return inserted;
}

async function getAlreadyImportedMunicipios(logId: number, uf: string): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT DISTINCT municipio FROM sicar_imoveis_cache 
     WHERE uf = $1 AND fetched_at >= (SELECT iniciado_em FROM sicar_import_log WHERE id = $2)`,
    [uf.toUpperCase(), logId]
  );
  return new Set(result.rows.map((r: any) => normalizeString(r.municipio || "")));
}

async function importMunicipio(uf: string, wfsName: string): Promise<number> {
  let total = 0;
  let startIndex = 0;
  let hasMore = true;
  currentProgress.municipioAtualImoveis = 0;

  while (hasMore) {
    const data = await fetchWfsPage(uf, wfsName, startIndex);
    const features = data.features || [];

    if (features.length === 0) {
      hasMore = false;
      break;
    }

    const inserted = await upsertBatch(features, uf, wfsName);
    total += inserted;
    startIndex += features.length;

    if (features.length < PAGE_SIZE) {
      hasMore = false;
    }
  }

  currentProgress.ultimoMunicipioCount = total;
  return total;
}

async function createImportLog(uf: string, municipio: string | null, tipo: string): Promise<number> {
  const result = await pool.query(
    `INSERT INTO sicar_import_log (uf, municipio, status, tipo) VALUES ($1, $2, 'running', $3) RETURNING id`,
    [uf.toUpperCase(), municipio, tipo]
  );
  return result.rows[0].id;
}

async function updateImportLog(
  logId: number,
  status: string,
  totalImoveis: number,
  totalErros: number
): Promise<void> {
  await pool.query(
    `UPDATE sicar_import_log SET 
      status = $1, total_imoveis = $2, total_erros = $3, 
      finalizado_em = CURRENT_TIMESTAMP,
      duracao_segundos = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - iniciado_em))::integer
     WHERE id = $4`,
    [status, totalImoveis, totalErros, logId]
  );
}

export async function importUF(
  uf: string,
  municipioFiltro?: string,
  tipo: string = "manual"
): Promise<{ totalImoveis: number; totalErros: number; logId: number }> {
  const logId = await createImportLog(uf, municipioFiltro || null, tipo);
  let totalImoveis = 0;
  let totalErros = 0;

  try {
    let municipios: string[];

    if (municipioFiltro) {
      municipios = [municipioFiltro];
    } else {
      const allMunicipios = await getMunicipios(uf);
      municipios = allMunicipios;
    }

    const alreadyDone = await getAlreadyImportedMunicipios(logId, uf);

    currentProgress.municipiosTotal = municipios.length;
    currentProgress.currentUf = uf.toUpperCase();

    for (let i = 0; i < municipios.length; i++) {
      const municipio = municipios[i];

      if (alreadyDone.has(normalizeString(municipio))) {
        currentProgress.municipiosProcessados = i + 1;
        continue;
      }

      currentProgress.currentMunicipio = toTitleCase(municipio);
      currentProgress.municipiosProcessados = i + 1;
      currentProgress.municipioAtualImoveis = 0;

      try {
        const count = await importMunicipio(uf, municipio);
        totalImoveis += count;
        currentProgress.imoveisImportados = totalImoveis;
      } catch (error: any) {
        totalErros++;
        currentProgress.erros = totalErros;
        console.error(`SICAR: Erro ao importar ${municipio}/${uf}: ${error.message}`);
      }

      if (i < municipios.length - 1) {
        await sleep(RATE_LIMIT_MS);
      }
    }

    await updateImportLog(logId, "completed", totalImoveis, totalErros);
  } catch (error: any) {
    await updateImportLog(logId, "error", totalImoveis, totalErros);
    console.error(`SICAR: Falha na importação de ${uf}: ${error.message}`);
  }

  return { totalImoveis, totalErros, logId };
}

export async function enqueueImport(
  ufs: string[],
  municipio?: string,
  tipo: string = "manual"
): Promise<void> {
  for (const uf of ufs) {
    importQueue.push({
      uf: uf.toUpperCase(),
      municipio,
      status: "pending",
    });
  }

  if (!isProcessing) {
    processQueue(tipo);
  }
}

async function processQueue(tipo: string): Promise<void> {
  isProcessing = true;
  currentProgress.running = true;
  currentProgress.iniciadoEm = new Date().toISOString();
  currentProgress.fila = importQueue
    .filter((q) => q.status === "pending")
    .map((q) => q.uf);

  while (importQueue.length > 0) {
    const item = importQueue.find((q) => q.status === "pending");
    if (!item) break;

    item.status = "running";
    currentProgress.currentUf = item.uf;
    currentProgress.municipiosProcessados = 0;
    currentProgress.municipiosTotal = 0;
    currentProgress.imoveisImportados = 0;
    currentProgress.municipioAtualImoveis = 0;
    currentProgress.ultimoMunicipioCount = 0;
    currentProgress.erros = 0;
    currentProgress.fila = importQueue
      .filter((q) => q.status === "pending")
      .map((q) => q.uf);

    try {
      const result = await importUF(item.uf, item.municipio, tipo);
      item.status = "done";
      item.logId = result.logId;
    } catch (error: any) {
      item.status = "error";
      console.error(`SICAR: Erro na fila para ${item.uf}: ${error.message}`);
    }
  }

  isProcessing = false;
  currentProgress = {
    running: false,
    currentUf: null,
    currentMunicipio: null,
    municipiosProcessados: 0,
    municipiosTotal: 0,
    imoveisImportados: 0,
    municipioAtualImoveis: 0,
    ultimoMunicipioCount: 0,
    erros: 0,
    fila: [],
    iniciadoEm: null,
  };
  importQueue = [];
}

export function getQueueProgress(): QueueProgress {
  return { ...currentProgress };
}
