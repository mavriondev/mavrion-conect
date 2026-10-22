import assert from "node:assert/strict";
import { resumirUsoSolo, descreverUsoSolo, apresentarUsoSolo, type ResumoUsoSolo } from "../uso-solo-amostragem";

function conferir(r: ResumoUsoSolo) {
  assert.equal(Object.values(r.grupos).reduce((s, p) => s + p, 0) + r.percentualSemDado, 100);
  assert.equal(Object.values(r.contagens).reduce((s, n) => s + n, 0), r.amostrasValidas);
  assert.equal(r.amostrasValidas + r.amostrasSemDado, r.amostrasTotal);
  for (const p of [...Object.values(r.grupos), r.percentualSemDado]) {
    assert.ok(p >= 0 && p <= 100 && p % 5 === 0);
  }
  assert.deepEqual(Object.keys(r.grupos).sort(), Object.keys(r.contagens).sort());
}

// Caso real: 7/8 e 1/8 antes viravam 90 + 15 = 105.
const excedia = resumirUsoSolo([15, 15, 15, 15, 15, 15, 15, 3])!;
conferir(excedia);
assert.deepEqual(excedia.grupos, { vegetacao_nativa: 15, pastagem: 85 });
assert.match(descreverUsoSolo(excedia), /~85% pastagem \(7\/8 pontos\)/);
// Também preserva 100 quando arredondar isoladamente daria 95.
const faltava = resumirUsoSolo([3, 15, 39, 39, 39, 39, 39, 39])!;
conferir(faltava);
assert.deepEqual(faltava.grupos, { vegetacao_nativa: 15, pastagem: 10, agricultura: 75 });
assert.deepEqual(resumirUsoSolo([39, 39, 39, 39, 39, 39, 15, 3]), faltava);

for (const classes of [[], [3, 3, 3], [15, 15, 15, null], [3, 3, 3, 3, null, null, null, null, null],
  [0, 27, null, undefined, NaN, Infinity, -1, 9999]]) {
  assert.equal(resumirUsoSolo(classes), null);
}
const metade = resumirUsoSolo([15, 15, 15, 3, null, undefined, 27, 999])!;
conferir(metade);
assert.equal(metade.amostrasSemDado, 4);
assert.equal(metade.percentualSemDado, 50);
assert.match(descreverUsoSolo(metade), /~50% sem dado \(4\/8 pontos\)/);

const rara = resumirUsoSolo([...Array(99).fill(15), 3])!;
conferir(rara);
assert.equal(rara.grupos.vegetacao_nativa, 0);
assert.equal(rara.contagens.vegetacao_nativa, 1);
assert.match(descreverUsoSolo(rara), /vegetação nativa: 1 ponto.*presença amostrada/);
const semDadoRaro = resumirUsoSolo([...Array(99).fill(15), null])!;
assert.match(descreverUsoSolo(semDadoRaro), /sem dado: 1 ponto/);

// Todas as combinações de 3 classes e sem dado até 20 pontos.
for (let total = 4; total <= 20; total++) {
  for (let nativa = 0; nativa <= total; nativa++) {
    for (let pasto = 0; pasto <= total - nativa; pasto++) {
      for (let agro = 0; agro <= total - nativa - pasto; agro++) {
        const classes = [...Array(nativa).fill(3), ...Array(pasto).fill(15), ...Array(agro).fill(39),
          ...Array(total - nativa - pasto - agro).fill(null)];
        const r = resumirUsoSolo(classes);
        if (nativa + pasto + agro < 4 || nativa + pasto + agro < total / 2) assert.equal(r, null);
        else conferir(r!);
      }
    }
  }
}
const todos = resumirUsoSolo([3, 15, 39, 9, 33, 24, 21, null])!;
conferir(todos);
assert.equal(Object.keys(todos.grupos).length, 7);
const exibido = apresentarUsoSolo({ ...excedia, descricao: "~90% pastagem, ~15% vegetação nativa" });
assert.match(exibido.texto, /85%/); // não confia na descrição salva
assert.match(exibido.detalhe!, /não área medida/);
assert.match(exibido.detalhe!, /8\/8 classificados/);
assert.doesNotMatch(exibido.texto, /ha\b/);
const legado = apresentarUsoSolo({ grupos: { pastagem: 90, vegetacao_nativa: 15 }, descricao: "90% e 15%" });
assert.match(legado.texto, /Pastagem; Vegetação nativa/);
assert.doesNotMatch(legado.texto, /%/);
assert.match(legado.detalhe!, /Atualize este ativo/);
assert.match(apresentarUsoSolo("Pastagem").detalhe!, /não representa a proporção/);
assert.equal(apresentarUsoSolo(null).texto, "");
console.log("uso-solo-amostragem: arredondamento, sem dado, classes raras e apresentação passaram");
