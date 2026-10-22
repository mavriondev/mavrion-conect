// Horn 3x3 do comparador de declividade: plano inclinado conhecido, buracos, sem dado e borda da janela.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { hornMedia, dentro, folhaTopodata, mediaRaster } = require("../scripts/comparar-declividade.cjs");

// grade sintética: 20x20 pixels de 0,001° (~111 m N-S) a partir de (-46, -18)
function grade(z) {
  const resX = 0.001, resY = 0.001, minX = -46, maxY = -18, cols = 20, rows = 20;
  const centro = (c, r) => [minX + (c + 0.5) * resX, maxY - (r + 0.5) * resY];
  const valor = (lon, lat) => {
    const c = Math.floor((lon - minX) / resX), r = Math.floor((maxY - lat) / resY);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return undefined;
    return z(c, r, ...centro(c, r));
  };
  return { grade: { resX, resY, cols, rows, centro }, valor };
}
const quadrado = [[[-45.995, -18.015], [-45.985, -18.015], [-45.985, -18.005], [-45.995, -18.005], [-45.995, -18.015]]];

test("plano com 10% de inclinação N-S dá 10%", () => {
  // z cresce 11,054 m por pixel para o sul (resY*110540 m = 110,54 m) → 10%
  const { grade: g, valor } = grade((c, r) => r * 11.054);
  const h = hornMedia(valor, g, quadrado);
  assert.ok(Math.abs(h.media - 10) < 0.01, `média ${h.media}`);
  assert.equal(h.semDado, 0); assert.equal(h.foraJanela, 0);
  assert.equal(h.pixels, 100); // 10x10 centros dentro do quadrado
});

test("plano com inclinação E-O usa metros por grau corrigidos pela latitude", () => {
  const mX = 0.001 * 111320 * Math.cos((-18.01 * Math.PI) / 180); // ~105,9 m por pixel
  const { grade: g, valor } = grade((c) => c * 0.2 * mX); // 20%
  const h = hornMedia(valor, g, quadrado);
  assert.ok(Math.abs(h.media - 20) < 0.05, `média ${h.media}`);
});

test("pixels sem dado na janela 3x3 são ignorados e contados", () => {
  const { grade: g, valor } = grade((c, r) => (c === 10 && r === 10 ? null : 0));
  const h = hornMedia(valor, g, quadrado);
  assert.equal(h.media, 0);
  assert.equal(h.semDado, 9); // o pixel nulo e seus 8 vizinhos perdem a janela
  assert.equal(h.pixels, 91);
});

test("pixel na borda do raster (janela incompleta) é ignorado", () => {
  const { grade: g, valor } = grade(() => 0);
  const tudo = [[[-46.1, -18.1], [-45.9, -18.1], [-45.9, -17.9], [-46.1, -17.9], [-46.1, -18.1]]];
  const h = hornMedia(valor, g, tudo);
  assert.equal(h.dentroPoligono, 400);
  assert.equal(h.foraJanela, 76); // moldura externa de 20x20
  assert.equal(h.pixels, 324);
});

test("buraco do polígono fica fora (par/ímpar) e a média do raster respeita o polígono", () => {
  const furo = [[-45.992, -18.012], [-45.988, -18.012], [-45.988, -18.008], [-45.992, -18.008], [-45.992, -18.012]];
  assert.equal(dentro(-45.99, -18.01, [...quadrado, furo]), false);
  assert.equal(dentro(-45.994, -18.014, [...quadrado, furo]), true);
  const { grade: g, valor } = grade(() => 7);
  const m = mediaRaster(valor, g, [...quadrado, furo]);
  assert.equal(m.media, 7); assert.equal(m.pixels, 100 - 16);
});

test("nome da folha TOPODATA segue a nomenclatura do INPE", () => {
  assert.equal(folhaTopodata(-18.58, -46.09), "18S465");
  assert.equal(folhaTopodata(-27.5, -50.2), "27S51_");
  assert.equal(folhaTopodata(-15.5, -44.9), "15S45_");
  assert.equal(folhaTopodata(-22.5, -46.6), "22S48_");
  assert.equal(folhaTopodata(-3.2, -60.1), "03S615");
});
