// Testes do mapeamento do backfill de TAH legada (script/backfill-anm-tah.ts):
// a cadeia de fallback do processo (camposEspecificos.processoAnm →
// attributesJson.anmProcesso → assets.anmProcesso) e o filtro por ano.
// Rodar com: npx tsx --test server/lib/__tests__/backfill-anm-tah.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeTahBackfillPatch, resolveProcesso } from "../../../script/backfill-anm-tah";

const legado = [
  { anoBase: 2024, nomeTitular: "Correto" },
  { anoBase: 1989, nomeTitular: "Alheio" },
];

const base = { id: 1, title: "t", anm_tah: legado };

describe("resolveProcesso — cadeia de fallback", () => {
  test("camposEspecificos.processoAnm tem prioridade", () => {
    assert.equal(resolveProcesso({ processo_anm: "832070/2024", attrs_anm_processo: "111111/1990", anm_processo: "222222/1991" }), "832070/2024");
  });
  test("cai para attributesJson.anmProcesso", () => {
    assert.equal(resolveProcesso({ processo_anm: null, attrs_anm_processo: "832070/2024", anm_processo: "222222/1991" }), "832070/2024");
  });
  test("cai para assets.anmProcesso", () => {
    assert.equal(resolveProcesso({ processo_anm: null, attrs_anm_processo: null, anm_processo: "832070/2024" }), "832070/2024");
  });
});

describe("computeTahBackfillPatch", () => {
  test("processo só em attributesJson.anmProcesso filtra pelo ano correspondente", () => {
    const patch = computeTahBackfillPatch({ ...base, processo_anm: null, attrs_anm_processo: "832.070/2024", anm_processo: null });
    assert.equal(patch.ambiguo, false);
    assert.deepEqual(patch.registros, [{ anoBase: 2024, nomeTitular: "Correto" }]);
  });
  test("processo completo em camposEspecificos filtra pelo ano", () => {
    const patch = computeTahBackfillPatch({ ...base, processo_anm: "832070/2024", attrs_anm_processo: null, anm_processo: null });
    assert.equal(patch.ambiguo, false);
    assert.deepEqual(patch.registros, [{ anoBase: 2024, nomeTitular: "Correto" }]);
  });
  test("sem ano em nenhuma fonte mantém registros mas marca ambíguo", () => {
    const patch = computeTahBackfillPatch({ ...base, processo_anm: "832070", attrs_anm_processo: null, anm_processo: null });
    assert.equal(patch.ambiguo, true);
    assert.equal(patch.registros.length, 2);
  });
  test("sem processo em nenhuma fonte marca ambíguo", () => {
    const patch = computeTahBackfillPatch({ ...base, processo_anm: null, attrs_anm_processo: null, anm_processo: null });
    assert.equal(patch.ambiguo, true);
  });
});
