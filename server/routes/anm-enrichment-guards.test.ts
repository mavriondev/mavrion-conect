import test from "node:test";
import assert from "node:assert/strict";
import { canWriteAsset, parseAssetId, chooseCnpjaCandidate } from "./anm-enrichment";

test("chooseCnpjaCandidate: registro único é usado direto", () => {
  const r = [{ taxId: "11507415000172", head: true, company: { name: "X" } }];
  assert.equal(chooseCnpjaCandidate("X", r), r[0]);
});

test("chooseCnpjaCandidate: matriz+filiais (mesma raiz) escolhe a MATRIZ, mesmo com match exato de nome em filial", () => {
  const records = [
    { taxId: "11507415000253", head: false, company: { name: "INDUSTRIAS REUNIDAS RAYMUNDO DA FONTE SA" } },
    { taxId: "11507415000172", head: true, company: { name: "INDUSTRIAS REUNIDAS RAYMUNDO DA FONTE SA" } },
    { taxId: "11507415000334", head: false, company: { name: "INDUSTRIAS REUNIDAS RAYMUNDO DA FONTE SA" } },
  ];
  const chosen = chooseCnpjaCandidate("INDUSTRIAS REUNIDAS RAYMUNDO DA FONTE SA", records);
  assert.equal(chosen.taxId, "11507415000172");
  assert.equal(chosen.head, true);
});

test("chooseCnpjaCandidate: raízes distintas exige match exato de razão social", () => {
  const records = [
    { taxId: "11111111000101", head: true, company: { name: "MINERADORA ALFA LTDA" } },
    { taxId: "22222222000102", head: true, company: { name: "ALFA COMERCIO LTDA" } },
  ];
  assert.equal(chooseCnpjaCandidate("MINERADORA ALFA LTDA", records)?.taxId, "11111111000101");
  assert.equal(chooseCnpjaCandidate("ALFA MINERACAO SA", records), null);
});

test("canWriteAsset: mesma organização pode escrever", () => {
  assert.equal(canWriteAsset(1, 1), true);
});

test("canWriteAsset: organização diferente NÃO pode escrever (IDOR)", () => {
  assert.equal(canWriteAsset(1, 2), false);
  assert.equal(canWriteAsset(2, 1), false);
});

test("canWriteAsset: ativo legado sem org é permitido", () => {
  assert.equal(canWriteAsset(null, 1), true);
  assert.equal(canWriteAsset(undefined, 1), true);
});

test("parseAssetId: aceita apenas inteiro positivo seguro", () => {
  assert.equal(parseAssetId("107"), 107);
  assert.equal(parseAssetId(107), 107);
  assert.equal(parseAssetId("0"), null);
  assert.equal(parseAssetId("-5"), null);
  assert.equal(parseAssetId("1.5"), null);
  assert.equal(parseAssetId("abc"), null);
  assert.equal(parseAssetId("1e999"), null);
  assert.equal(parseAssetId(String(Number.MAX_SAFE_INTEGER + 1)), null);
  assert.equal(parseAssetId(""), null);
});
