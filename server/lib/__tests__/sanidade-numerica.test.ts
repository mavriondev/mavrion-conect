import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checarPercentual,
  checarIntersecao,
  checarSomaPartes,
  checarOrdemCronologica,
  sanearSobreposicao,
} from "../sanidade-numerica";

describe("checarPercentual — nenhum percentual exibível excede 100%", () => {
  it("aceita 0–100", () => {
    assert.deepEqual(checarPercentual(0), { ok: true, valor: 0 });
    assert.deepEqual(checarPercentual(42.5), { ok: true, valor: 42.5 });
    assert.deepEqual(checarPercentual(100), { ok: true, valor: 100 });
  });
  it("grampeia arredondamento leve (≤ 100,5) em 100", () => {
    assert.deepEqual(checarPercentual(100.4), { ok: true, valor: 100 });
  });
  it("rejeita acima da tolerância com motivo", () => {
    const r = checarPercentual(160.2, "soma CCIR");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.aVerificar, true);
      assert.match(r.motivo, /excede 100%/);
      assert.match(r.motivo, /soma CCIR/);
      assert.equal(r.valorOriginal, 160.2);
    }
  });
  it("rejeita negativo e não numérico", () => {
    assert.equal(checarPercentual(-1).ok, false);
    assert.equal(checarPercentual(NaN).ok, false);
    assert.equal(checarPercentual("abc").ok, false);
  });
});

describe("checarIntersecao — interseção ≤ área do menor polígono", () => {
  it("aceita interseção menor que ambas as áreas", () => {
    const r = checarIntersecao(10, 50, 100);
    assert.deepEqual(r, { ok: true, valor: 10 });
  });
  it("grampeia excesso dentro da tolerância no menor", () => {
    const r = checarIntersecao(50.2, 50, 1000);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.valor, 50);
  });
  it("rejeita interseção maior que o menor polígono", () => {
    const r = checarIntersecao(80, 50, 1000, "CAR×INCRA");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /excede a área do menor polígono/);
  });
  it("não bloqueia quando as áreas de referência são desconhecidas", () => {
    assert.deepEqual(checarIntersecao(80, null, undefined), { ok: true, valor: 80 });
  });
  it("rejeita interseção negativa", () => {
    assert.equal(checarIntersecao(-2, 50, 100).ok, false);
  });
});

describe("checarSomaPartes — soma das partes ≤ todo", () => {
  it("aceita soma dentro do todo", () => {
    assert.deepEqual(checarSomaPartes([10, 20, 30], 100), { ok: true, valor: 60 });
  });
  it("rejeita soma que estoura o todo", () => {
    const r = checarSomaPartes([80, 80], 100, "parcelas do imóvel");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /excede o todo/);
  });
  it("todo desconhecido não bloqueia", () => {
    assert.deepEqual(checarSomaPartes([80, 80], null), { ok: true, valor: 160 });
  });
  it("ignora partes não numéricas", () => {
    assert.deepEqual(checarSomaPartes([10, null, "x", 5], 100), { ok: true, valor: 15 });
  });
});

describe("checarOrdemCronologica", () => {
  it("aceita ordem não decrescente e ignora nulos", () => {
    assert.equal(checarOrdemCronologica(["2020-01-01", null, "2020-01-01", "2021-06-30"]).ok, true);
  });
  it("detecta data fora de ordem", () => {
    const r = checarOrdemCronologica(["2022-01-01", "2020-01-01"], "eventos ANM");
    assert.equal(r.ok, false);
    assert.match(r.motivo!, /fora de ordem/);
  });
});

describe("sanearSobreposicao — falha vira marcador 'a verificar' e apaga os números", () => {
  it("par válido passa intacto", () => {
    const r = sanearSobreposicao({ sobreposicaoHa: 12.3, sobreposicaoPct: 4.5, areaMenorHa: 100 });
    assert.deepEqual(r, { sobreposicaoHa: 12.3, sobreposicaoPct: 4.5 });
  });
  it("pct > 100 contamina o par inteiro", () => {
    const r = sanearSobreposicao({ sobreposicaoHa: 12.3, sobreposicaoPct: 160.2, contexto: "soma por imóvel" });
    assert.equal(r.sobreposicaoHa, null);
    assert.equal(r.sobreposicaoPct, null);
    assert.match(r.sobreposicaoAVerificar!, /excede 100%/);
  });
  it("interseção maior que o menor polígono contamina o par", () => {
    const r = sanearSobreposicao({ sobreposicaoHa: 500, sobreposicaoPct: 10, areaMenorHa: 100 });
    assert.equal(r.sobreposicaoPct, null);
    assert.match(r.sobreposicaoAVerificar!, /menor polígono/);
  });
  it("valores ausentes não inventam falha", () => {
    const r = sanearSobreposicao({ sobreposicaoHa: null, sobreposicaoPct: null });
    assert.deepEqual(r, { sobreposicaoHa: null, sobreposicaoPct: null });
  });
});
