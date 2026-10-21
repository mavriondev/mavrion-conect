import { pool } from "../db";

const BASE_URL = "https://agrofit.agricultura.gov.br/agrofit_cons/!ap_produto_form_detalhe_cons";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 1200;

interface ScrapedProduct {
  idAgrofit: number;
  marcaComercial: string | null;
  nrRegistro: string | null;
  classe: string | null;
  classificacaoToxicologica: string | null;
  classificacaoAmbiental: string | null;
  formulacao: string | null;
  ingredienteInerteQtd: string | null;
  ingredienteInerteUnidade: string | null;
  titularRegistro: string | null;
  ingredientes: Array<{
    tipo: string | null;
    nome: string | null;
    componente: string | null;
    quantidade: string | null;
    unidadeMedida: string | null;
    percentual: string | null;
    grupoQuimico: string | null;
    nomeIupac: string | null;
    nomeCa: string | null;
    formulaBruta: string | null;
  }>;
  indicacoes: Array<{
    cultura: string | null;
    praga: string | null;
    nomeComum: string | null;
    doseMin: string | null;
    doseMax: string | null;
    unidadeDose: string | null;
    volumeCaldaMin: string | null;
    volumeCaldaMax: string | null;
    intervaloAplicacao: string | null;
    intervaloSeguranca: string | null;
    epocaAplicacao: string | null;
  }>;
}

function cleanText(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = s
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function extractInputValue(html: string, fieldName: string): string | null {
  const regex = new RegExp(`NAME=["']?${fieldName}["']?[^>]*value=["']([^"']*)["']`, "i");
  const match = html.match(regex);
  return cleanText(match?.[1]);
}

function extractClasse(html: string): string | null {
  const match = html.match(/incluirClasse\("([^"]+)"\)/);
  return cleanText(match?.[1]);
}

function resolveJsConcat(raw: string): string {
  let result = "";
  const parts = raw.split(/\s*\+\s*/);
  for (const part of parts) {
    const dqMatch = part.match(/^"([^"]*)"$/);
    if (dqMatch) { result += dqMatch[1]; continue; }
    const sqMatch = part.match(/^'([^']*)'$/);
    if (sqMatch) { result += sqMatch[1]; continue; }
    const trimmed = part.trim();
    if (trimmed === '""' || trimmed === "''") continue;
  }
  return result;
}

function extractIngredientes(html: string): ScrapedProduct["ingredientes"] {
  const results: ScrapedProduct["ingredientes"] = [];

  const blockRegex = /incluirIngrediente\("([\s\S]*?)(?:\)\s*;|\)\s*$)/gm;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null) {
    const fullCall = blockMatch[0];
    if (fullCall.includes("function ") || fullCall.includes("document.all")) continue;

    const paramRegex = /incluirIngrediente\(\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)",\s*"([^"]*)"/s;
    const basicMatch = fullCall.match(paramRegex);

    if (!basicMatch) continue;

    let nomeIupac: string | null = null;
    let nomeCa: string | null = null;
    let formulaBruta: string | null = null;

    const afterBasic = fullCall.substring(basicMatch[0].length);
    const concatParts = afterBasic.split(/,\s*(?=""\s*\n|\s*""\s*$)/);

    const concatBlocks: string[] = [];
    const remaining = afterBasic.replace(/^\s*,\s*/, "");
    const splitByCommaOutsideQuotes = remaining.split(/,\s*(?=""[\s\r\n]*\+|""[\s\r\n]*\+)/);

    const fullAfterSeven = fullCall.substring(fullCall.indexOf(basicMatch[7]!) + basicMatch[7]!.length);
    const threeLastParams = fullAfterSeven.match(/,\s*(""[\s\S]*?"")\s*,\s*(""[\s\S]*?"")\s*,\s*(""[\s\S]*?"")\s*\)/);

    if (threeLastParams) {
      nomeIupac = cleanText(resolveJsConcat(threeLastParams[1]));
      nomeCa = cleanText(resolveJsConcat(threeLastParams[2]));
      formulaBruta = cleanText(resolveJsConcat(threeLastParams[3]));
    } else {
      const twoLastParams = fullAfterSeven.match(/,\s*(""[\s\S]*?"")\s*,\s*(""[\s\S]*?"")\s*\)/);
      if (twoLastParams) {
        nomeIupac = cleanText(resolveJsConcat(twoLastParams[1]));
        nomeCa = cleanText(resolveJsConcat(twoLastParams[2]));
      }
    }

    results.push({
      tipo: cleanText(basicMatch[1]),
      nome: cleanText(basicMatch[2]),
      componente: cleanText(basicMatch[3]),
      quantidade: cleanText(basicMatch[4]),
      unidadeMedida: cleanText(basicMatch[5]),
      percentual: cleanText(basicMatch[6]),
      grupoQuimico: cleanText(basicMatch[7]),
      nomeIupac,
      nomeCa,
      formulaBruta,
    });
  }

  return results;
}

function extractTdText(td: string): string | null {
  let text = td
    .replace(/<A[^>]*>[\s\S]*?<\/A>/gi, "")
    .replace(/<[^>]+>/g, "");
  return cleanText(text);
}

function extractLinkText(td: string): string | null {
  const m = td.match(/<A[^>]*class="verde"[^>]*>([\s\S]*?)<\/A>/i);
  if (!m) return null;
  return cleanText(m[1].replace(/<[^>]+>/g, ""));
}

function extractIndicacoes(html: string): ScrapedProduct["indicacoes"] {
  const results: ScrapedProduct["indicacoes"] = [];
  const rowRegex = /<TR\s+CLASS="labelCampo"\s+BGCOLOR[^>]*>([\s\S]*?)<\/TR>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    const tdRegex = /<TD[^>]*>([\s\S]*?)<\/TD>/gi;
    const tds: string[] = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      tds.push(tdMatch[1]);
    }

    if (tds.length < 3) continue;

    const cultura = extractLinkText(tds[0]);
    const praga = extractLinkText(tds[1]);
    const nomeComum = extractLinkText(tds[2]);

    if (!cultura && !praga) continue;

    const doseMin = tds.length > 3 ? extractTdText(tds[3]) : null;
    const doseMax = tds.length > 4 ? extractTdText(tds[4]) : null;
    const unidadeDose = tds.length > 5 ? extractTdText(tds[5]) : null;
    const volumeCaldaMin = tds.length > 6 ? extractTdText(tds[6]) : null;
    const volumeCaldaMax = tds.length > 7 ? extractTdText(tds[7]) : null;

    const intervaloAplicacao = tds.length > 12 ? extractTdText(tds[12]) : null;
    const intervaloSeguranca = tds.length > 13 ? extractTdText(tds[13]) : null;
    const epocaAplicacao = tds.length > 14 ? extractTdText(tds[14]) : null;

    const exists = results.some(
      (r) => r.cultura === cultura && r.praga === praga && r.nomeComum === nomeComum &&
        r.doseMin === doseMin && r.doseMax === doseMax
    );
    if (!exists) {
      results.push({
        cultura, praga, nomeComum,
        doseMin, doseMax, unidadeDose,
        volumeCaldaMin, volumeCaldaMax,
        intervaloAplicacao, intervaloSeguranca, epocaAplicacao,
      });
    }
  }

  return results;
}

function parseProductPage(html: string, idAgrofit: number): ScrapedProduct | null {
  const hasClasse = /incluirClasse\("[^"]+"\)/.test(html);
  const hasMarca = /p_nm_marca_comercial["']?\s+value="[^"]+"/i.test(html);

  if (!hasClasse && !hasMarca) {
    return null;
  }

  return {
    idAgrofit,
    marcaComercial: extractInputValue(html, "p_nm_marca_comercial"),
    nrRegistro: extractInputValue(html, "p_nr_registro"),
    classe: extractClasse(html),
    classificacaoToxicologica: extractInputValue(html, "p_ds_classificacao_tox"),
    classificacaoAmbiental: extractInputValue(html, "p_ds_classificacao_amb"),
    formulacao: extractInputValue(html, "p_ds_formulacao") || extractInputValue(html, "p_nm_formulacao"),
    ingredienteInerteQtd: extractInputValue(html, "p_qt_ingrediente_inerte"),
    ingredienteInerteUnidade: extractInputValue(html, "p_nm_unidade_medida_inerte"),
    titularRegistro: extractInputValue(html, "p_nm_registrante_empresa"),
    ingredientes: extractIngredientes(html),
    indicacoes: extractIndicacoes(html),
  };
}

async function fetchProductPage(id: number): Promise<string | null> {
  try {
    const url = `${BASE_URL}?p_id_produto_formulado_tecnico=${id}&p_tipo_janela=NEW`;
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder("iso-8859-1");
    return decoder.decode(buffer);
  } catch {
    return null;
  }
}

async function saveProduct(product: ScrapedProduct): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const status = product.marcaComercial && /cancel|suspen/i.test(product.marcaComercial) ? "cancelado" : "ativo";

    const upsertResult = await client.query(
      `INSERT INTO agrofit_produtos (id_agrofit, marca_comercial, nr_registro, classe, classificacao_toxicologica, classificacao_ambiental, formulacao, ingrediente_inerte_qtd, ingrediente_inerte_unidade, titular_registro, status, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (id_agrofit) DO UPDATE SET
         marca_comercial = EXCLUDED.marca_comercial,
         nr_registro = EXCLUDED.nr_registro,
         classe = EXCLUDED.classe,
         classificacao_toxicologica = EXCLUDED.classificacao_toxicologica,
         classificacao_ambiental = EXCLUDED.classificacao_ambiental,
         formulacao = EXCLUDED.formulacao,
         ingrediente_inerte_qtd = EXCLUDED.ingrediente_inerte_qtd,
         ingrediente_inerte_unidade = EXCLUDED.ingrediente_inerte_unidade,
         titular_registro = EXCLUDED.titular_registro,
         status = EXCLUDED.status,
         fetched_at = NOW()
       RETURNING id`,
      [
        product.idAgrofit,
        product.marcaComercial,
        product.nrRegistro,
        product.classe,
        product.classificacaoToxicologica,
        product.classificacaoAmbiental,
        product.formulacao,
        product.ingredienteInerteQtd,
        product.ingredienteInerteUnidade,
        product.titularRegistro,
        status,
      ]
    );

    const produtoId = upsertResult.rows[0].id;

    await client.query("DELETE FROM agrofit_ingredientes WHERE produto_id = $1", [produtoId]);
    for (const ing of product.ingredientes) {
      await client.query(
        `INSERT INTO agrofit_ingredientes (produto_id, tipo, nome, componente, quantidade, unidade_medida, percentual, grupo_quimico, nome_iupac, nome_ca, formula_bruta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [produtoId, ing.tipo, ing.nome, ing.componente, ing.quantidade, ing.unidadeMedida, ing.percentual, ing.grupoQuimico, ing.nomeIupac, ing.nomeCa, ing.formulaBruta]
      );
    }

    await client.query("DELETE FROM agrofit_indicacoes WHERE produto_id = $1", [produtoId]);
    for (const ind of product.indicacoes) {
      await client.query(
        `INSERT INTO agrofit_indicacoes (produto_id, cultura, praga, nome_comum, dose_min, dose_max, unidade_dose, volume_calda_min, volume_calda_max, intervalo_aplicacao, intervalo_seguranca, epoca_aplicacao)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [produtoId, ind.cultura, ind.praga, ind.nomeComum, ind.doseMin, ind.doseMax, ind.unidadeDose, ind.volumeCaldaMin, ind.volumeCaldaMax, ind.intervaloAplicacao, ind.intervaloSeguranca, ind.epocaAplicacao]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

let importState = {
  running: false,
  currentId: 0,
  idInicio: 0,
  idFim: 0,
  produtosEncontrados: 0,
  produtosProcessados: 0,
  erros: 0,
  ultimoProduto: null as string | null,
  iniciadoEm: null as string | null,
};

export function getImportProgress() {
  return { ...importState };
}

export async function startImport(idInicio: number, idFim: number): Promise<void> {
  if (importState.running) {
    throw new Error("Importação já em andamento");
  }

  importState = {
    running: true,
    currentId: idInicio,
    idInicio,
    idFim,
    produtosEncontrados: 0,
    produtosProcessados: 0,
    erros: 0,
    ultimoProduto: null,
    iniciadoEm: new Date().toISOString(),
  };

  const startTime = Date.now();

  await pool.query(
    `INSERT INTO agrofit_import_log (status, id_inicio, id_fim, iniciado_em) VALUES ('running', $1, $2, NOW())`,
    [idInicio, idFim]
  );
  const logResult = await pool.query("SELECT id FROM agrofit_import_log ORDER BY id DESC LIMIT 1");
  const logId = logResult.rows[0]?.id;

  try {
    for (let id = idInicio; id <= idFim; id++) {
      if (!importState.running) break;

      importState.currentId = id;
      importState.produtosProcessados++;

      try {
        const html = await fetchProductPage(id);
        if (!html || html.length < 1000) {
          continue;
        }

        const product = parseProductPage(html, id);
        if (!product) {
          continue;
        }

        await saveProduct(product);
        importState.produtosEncontrados++;
        importState.ultimoProduto = product.marcaComercial || `ID ${id}`;
      } catch (err: any) {
        importState.erros++;
        console.error(`[AGROFIT] Erro ao processar ID ${id}:`, err.message);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    const wasStopped = importState.currentId < idFim && !importState.running;
    const finalStatus = wasStopped ? "stopped" : "completed";
    await pool.query(
      `UPDATE agrofit_import_log SET status = $5, total_produtos = $1, total_erros = $2, finalizado_em = NOW(), duracao_segundos = $3 WHERE id = $4`,
      [importState.produtosEncontrados, importState.erros, duration, logId, finalStatus]
    );
  } catch (err: any) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    await pool.query(
      `UPDATE agrofit_import_log SET status = 'error', total_produtos = $1, total_erros = $2, finalizado_em = NOW(), duracao_segundos = $3 WHERE id = $4`,
      [importState.produtosEncontrados, importState.erros, duration, logId]
    );
    console.error("[AGROFIT] Erro na importação:", err.message);
  } finally {
    importState.running = false;
  }
}

export function stopImport(): void {
  importState.running = false;
}
