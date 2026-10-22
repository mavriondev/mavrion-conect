// Comparação de métodos de declividade em uma AMOSTRA de imóveis (sem escrita em banco).
//
//   antigo   : método em produção (MLe): média da inclinação de cada um dos ≤17 pontos (grade 4x4 dentro do
//              polígono + ponto garantido) até o vizinho mais próximo a ≥ 90 m, sobre os tiles SRTM 90 m locais.
//   horn     : inclinação por pixel (Horn 3x3) sobre os mesmos tiles SRTM 90 m; média dos pixels cujo centro
//              cai dentro do polígono (anéis internos excluídos), ignorando pixels sem dado e pixels cuja janela
//              3x3 não está completa (borda do raster / vizinho sem dado).
//   topodata : média, dentro do polígono, da camada TOPODATA/INPE "SN" (declividade em %, 30 m, derivada do
//              SRTM por krigagem) lida como COG direto do data.inpe.br.
//
// Uso (na VPS, processo isolado, só leitura):
//   node comparar-declividade.cjs <amostra.json> <saida.json> [fonte-hub=/var/www/mavrion-api/fonte/src/index.cjs]
// A amostra é o JSON exportado por uma consulta somente leitura (id, uf, municipio, num_area, declividade,
// gj, grade_pts, pos_lat, pos_lon, centroid_lat, centroid_lon, relevo).

"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { Module } = require("node:module");


// ---- carrega só a parte "segura" do bundle da Hub (sem servidor, sem agendadores) ----
function carregarHub(fonte) {
  const source = fs.readFileSync(fonte, "utf8");
  const marker = source.indexOf("var wJ = {};");
  if (marker < 0) throw new Error("marcador do módulo seguro ausente no fonte da Hub");
  const root = path.dirname(path.dirname(path.dirname(fonte))); // .../fonte/src/index.cjs -> raiz do app
  // O módulo de pool do bundle exige DATABASE_URL ao inicializar; este script não consulta banco nenhum,
  // então aponta para um destino inválido — qualquer tentativa de conexão falharia em vez de tocar produção.
  process.env.DATABASE_URL = "postgresql://nenhum:nenhum@127.0.0.1:1/comparacao_sem_banco";
  const m = new Module(path.join(root, "comparar-declividade-isolado.cjs"), module);
  m.filename = path.join(root, "comparar-declividade-isolado.cjs");
  m.paths = Module._nodeModulePaths(root);
  m._compile(source.slice(0, marker) + `
    WE(); JV();
    module.exports = { fromUrl: jV, fromFile: zE, antigo: MLe, tileFor: DLe, loadTile: HV, elevAt: LLe, tilesDir: VE, nodata: vLe, tiles: cc };
  `, m.filename);
  return m.exports;
}

// ---- geometria ----
function aneis(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  return polys.flat(); // todos os anéis (externos e internos); par/ímpar trata buracos
}
function dentro(lon, lat, rings) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function bboxDe(rings) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < minLon) minLon = x; if (x > maxLon) maxLon = x; if (y < minLat) minLat = y; if (y > maxLat) maxLat = y; }
  return { minLon, minLat, maxLon, maxLat };
}

// ---- leitura de janelas de raster (GeoTIFF/COG) numa grade comum ----
// Devolve função elev(lon,lat) -> número | null sobre a união das janelas lidas, e a resolução.
async function janela(image, bbox, pad, nodataExtra) {
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const W = image.getWidth(), H = image.getHeight();
  const resX = (maxX - minX) / W, resY = (maxY - minY) / H;
  const x0 = Math.max(0, Math.floor((bbox.minLon - minX) / resX) - pad);
  const x1 = Math.min(W, Math.ceil((bbox.maxLon - minX) / resX) + pad);
  const y0 = Math.max(0, Math.floor((maxY - bbox.maxLat) / resY) - pad);
  const y1 = Math.min(H, Math.ceil((maxY - bbox.minLat) / resY) + pad);
  if (x1 <= x0 || y1 <= y0) return null;
  const data = (await image.readRasters({ window: [x0, y0, x1, y1] }))[0];
  const nd = image.getGDALNoData?.() ?? null;
  const w = x1 - x0;
  return {
    resX, resY,
    // centro do pixel (col,row) desta janela em coordenadas geográficas
    centro: (c, r) => [minX + (x0 + c + 0.5) * resX, maxY - (y0 + r + 0.5) * resY],
    cols: w, rows: y1 - y0,
    valor: (lon, lat) => {
      const c = Math.floor((lon - minX) / resX) - x0, r = Math.floor((maxY - lat) / resY) - y0;
      if (c < 0 || r < 0 || c >= w || r >= y1 - y0) return undefined; // fora desta janela
      const v = data[r * w + c];
      if (v == null || Number.isNaN(v) || v === nd || v === nodataExtra) return null;
      return v;
    },
  };
}
function unir(janelas) {
  return (lon, lat) => {
    for (const j of janelas) { const v = j.valor(lon, lat); if (v !== undefined) return v; }
    return undefined;
  };
}

// ---- Horn 3x3 sobre a grade do raster de altitude ----
function hornMedia(elev, grade, rings) {
  const { resX, resY, cols, rows, centro } = grade;
  let soma = 0, n = 0, semDado = 0, foraJanela = 0, dentroPoligono = 0;
  const mY = resY * 110540; // metros por grau de latitude (aprox.)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const [lon, lat] = centro(c, r);
    if (!dentro(lon, lat, rings)) continue;
    dentroPoligono++;
    const z = [];
    let falta = false, fora = false;
    for (let dr = -1; dr <= 1 && !falta && !fora; dr++) for (let dc = -1; dc <= 1; dc++) {
      const [ln, lt] = centro(c + dc, r + dr);
      const v = elev(ln, lt);
      if (v === undefined) { fora = true; break; }
      if (v === null) { falta = true; break; }
      z.push(v);
    }
    if (fora) { foraJanela++; continue; }
    if (falta) { semDado++; continue; }
    const [a, b, c2, d, , f, g, h, i] = z;
    const mX = resX * 111320 * Math.cos((lat * Math.PI) / 180);
    const dzdx = ((c2 + 2 * f + i) - (a + 2 * d + g)) / (8 * mX);
    const dzdy = ((g + 2 * h + i) - (a + 2 * b + c2)) / (8 * mY);
    soma += 100 * Math.sqrt(dzdx * dzdx + dzdy * dzdy);
    n++;
  }
  return { media: n ? soma / n : null, pixels: n, dentroPoligono, semDado, foraJanela };
}
function mediaRaster(valor, grade, rings) {
  let soma = 0, n = 0, semDado = 0, dentroPoligono = 0;
  for (let r = 0; r < grade.rows; r++) for (let c = 0; c < grade.cols; c++) {
    const [lon, lat] = grade.centro(c, r);
    if (!dentro(lon, lat, rings)) continue;
    dentroPoligono++;
    const v = valor(lon, lat);
    if (v == null) { semDado++; continue; }
    soma += v; n++;
  }
  return { media: n ? soma / n : null, pixels: n, dentroPoligono, semDado };
}

// ---- TOPODATA (STAC do INPE; folhas de 1° lat x 1,5° lon) ----
function folhaTopodata(lat, lon) {
  const la = Math.floor(Math.abs(lat)), he = lat < 0 ? "S" : "N";
  const w = Math.ceil(Math.abs(lon) / 1.5) * 1.5; // borda oeste da folha (ex.: 46,5 cobre 46,5..45,0 W)
  // Nomenclatura do INPE: "465" = 46,5°; longitude inteira leva "_" no lugar do decimal ("48_" = 48,0°).
  const lonTxt = Number.isInteger(w) ? `${String(w).padStart(2, "0")}_` : String(Math.round(w * 10)).padStart(3, "0");
  return `${String(la).padStart(2, "0")}${he}${lonTxt}`;
}
const topoCache = new Map();
async function imagemTopodata(fromUrl, folha) {
  if (topoCache.has(folha)) return topoCache.get(folha);
  let href = null;
  try {
    const r = await fetch(`https://data.inpe.br/bdc/stac/v1/collections/topodata-1/items/${folha}`, { signal: AbortSignal.timeout(30000) });
    if (r.ok) href = (await r.json())?.assets?.SN?.href ?? null;
  } catch { href = null; }
  if (!href) href = `https://data.inpe.br/bdc/data/topodata/v001/${folha.slice(0, 3)}/${folha.slice(3)}/${folha}SN.tif`;
  const p = (async () => { try { return { href, image: await (await fromUrl(href)).getImage() }; } catch (e) { return { href, erro: e.message }; } })();
  topoCache.set(folha, p);
  return p;
}

module.exports = { hornMedia, mediaRaster, dentro, aneis, bboxDe, folhaTopodata, janela, unir };

async function main() {
  const [amostraPath, saidaPath, fontePath = "/var/www/mavrion-api/fonte/src/index.cjs"] = process.argv.slice(2);
  if (!amostraPath || !saidaPath) {
    console.error("uso: node comparar-declividade.cjs <amostra.json> <saida.json> [fonte-hub]");
    process.exit(2);
  }
  const hub = carregarHub(fontePath);
  const amostra = JSON.parse(fs.readFileSync(amostraPath, "utf8"));
  const out = { geradoEm: new Date().toISOString(), fonteHub: fontePath, tilesDir: hub.tilesDir, imoveis: [] };

  for (const im of amostra) {
    const geom = typeof im.gj === "string" ? JSON.parse(im.gj) : im.gj;
    const rings = aneis(geom);
    const bbox = bboxDe(rings);
    const linha = { id: im.id, uf: im.uf, municipio: im.municipio, relevo: im.relevo, area_ha: im.num_area, declividade_producao: im.declividade };
    try {
      // tiles SRTM que tocam a caixa (+1 px de folga para o Horn)
      const nomes = new Set();
      for (const lat of [bbox.minLat - 0.002, bbox.maxLat + 0.002]) for (const lon of [bbox.minLon - 0.002, bbox.maxLon + 0.002]) nomes.add(hub.tileFor(lat, lon));
      const janelas = [];
      for (const nome of nomes) {
        if (!hub.tiles.get(nome) && !(await hub.loadTile(nome))) throw new Error(`tile SRTM ${nome} indisponível`);
        const j = await janela(hub.tiles.get(nome), bbox, 2, hub.nodata);
        if (j) janelas.push(j);
      }
      if (janelas.length === 0) throw new Error("nenhuma janela SRTM");
      const elev = unir(janelas);
      // grade de referência: janela do tile que contém o centroide (ou a primeira)
      const refNome = hub.tileFor(+im.centroid_lat, +im.centroid_lon);
      const grade = janelas[[...nomes].indexOf(refNome)] || janelas[0];
      const horn = hornMedia(elev, grade, rings);

      // método antigo com os MESMOS pontos usados em produção (grade 4x4 dentro + ponto garantido)
      const pts = (Array.isArray(im.grade_pts) ? im.grade_pts : []).map(([lat, lon]) => ({ lat: +lat, lon: +lon }));
      if (Number.isFinite(+im.pos_lat) && Number.isFinite(+im.pos_lon)) pts.push({ lat: +im.pos_lat, lon: +im.pos_lon });
      if (pts.length === 0) pts.push({ lat: +im.centroid_lat, lon: +im.centroid_lon });
      const alts = [], usados = [];
      for (const p of pts) { const z = await hub.elevAt(p.lat, p.lon); if (z !== null) { alts.push(z); usados.push(p); } }
      const antigo = hub.antigo(usados, alts);

      // TOPODATA SN (30 m)
      const folhas = new Set();
      for (const lat of [bbox.minLat, bbox.maxLat]) for (const lon of [bbox.minLon, bbox.maxLon]) folhas.add(folhaTopodata(lat, lon));
      const topoJanelas = [], topoErros = [];
      for (const folha of folhas) {
        const t = await imagemTopodata(hub.fromUrl, folha);
        if (t.erro) { topoErros.push(`${folha}: ${t.erro}`); continue; }
        const j = await janela(t.image, bbox, 1, -9999);
        if (j) topoJanelas.push(j);
      }
      let topo = { media: null, pixels: 0, dentroPoligono: 0, semDado: 0 };
      if (topoJanelas.length) topo = mediaRaster(unir(topoJanelas), topoJanelas[0], rings);

      Object.assign(linha, {
        antigo_pct: antigo, antigo_pontos: usados.length,
        horn_pct: horn.media == null ? null : Math.round(horn.media * 100) / 100, horn_pixels: horn.pixels, horn_dentro: horn.dentroPoligono, horn_sem_dado: horn.semDado, horn_fora_janela: horn.foraJanela,
        topodata_pct: topo.media == null ? null : Math.round(topo.media * 100) / 100, topodata_pixels: topo.pixels, topodata_sem_dado: topo.semDado, topodata_folhas: [...folhas], topodata_erros: topoErros,
        tiles_srtm: [...nomes],
      });
      if (linha.topodata_pct != null) {
        if (antigo != null) linha.erro_antigo = Math.round((antigo - linha.topodata_pct) * 100) / 100;
        if (linha.horn_pct != null) linha.erro_horn = Math.round((linha.horn_pct - linha.topodata_pct) * 100) / 100;
      }
    } catch (e) {
      linha.erro = e.message;
    }
    out.imoveis.push(linha);
    console.error(JSON.stringify(linha));
  }

  // resumo
  const ok = out.imoveis.filter((l) => l.topodata_pct != null && l.horn_pct != null && l.antigo_pct != null);
  const stats = (vals) => {
    if (!vals.length) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const mae = vals.reduce((a, b) => a + Math.abs(b), 0) / vals.length;
    const rmse = Math.sqrt(vals.reduce((a, b) => a + b * b, 0) / vals.length);
    return { n: vals.length, vies: Math.round(mean * 100) / 100, mae: Math.round(mae * 100) / 100, rmse: Math.round(rmse * 100) / 100 };
  };
  out.resumo = {
    comparaveis: ok.length,
    media_antigo: ok.length ? Math.round((ok.reduce((a, l) => a + l.antigo_pct, 0) / ok.length) * 100) / 100 : null,
    media_horn: ok.length ? Math.round((ok.reduce((a, l) => a + l.horn_pct, 0) / ok.length) * 100) / 100 : null,
    media_topodata: ok.length ? Math.round((ok.reduce((a, l) => a + l.topodata_pct, 0) / ok.length) * 100) / 100 : null,
    erro_antigo_vs_topodata: stats(ok.map((l) => l.erro_antigo)),
    erro_horn_vs_topodata: stats(ok.map((l) => l.erro_horn)),
    por_relevo: Object.fromEntries(["plana", "ondulada", "montanhosa"].map((rel) => {
      const g = ok.filter((l) => l.relevo === rel);
      return [rel, { n: g.length, erro_antigo: stats(g.map((l) => l.erro_antigo)), erro_horn: stats(g.map((l) => l.erro_horn)) }];
    })),
  };
  fs.writeFileSync(saidaPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.resumo, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
