// Testes de solo ponderado e temperatura média — rodar com: npx tsx server/lib/__tests__/agro-solo-clima.test.ts
import assert from "node:assert";
import { aplicarMediaPonderadaSolo, soloVazio, temperaturaMediaAnual, type ClimaResult } from "../../enrichment/agro";

const camada = (label: string, mean: number | null) => ({ label, values: { mean } });

// Argila crescendo com a profundidade (típico de latossolo): 30%, 40%, 50% (SoilGrids devolve g/kg)
{
  const r = soloVazio();
  const ok = aplicarMediaPonderadaSolo(
    [{ name: "clay", depths: [camada("0-5cm", 300), camada("5-15cm", 400), camada("15-30cm", 500)] }],
    r,
  );
  assert.equal(ok, true);
  // ponderada pela espessura (5, 10, 15 cm) = 43,33 — a média simples daria 40 e só 0-5 cm daria 30
  assert.equal(r.clay, 43.33);
}

// pH: fator 0,1 (SoilGrids devolve pH x 10)
{
  const r = soloVazio();
  aplicarMediaPonderadaSolo([{ name: "phh2o", depths: [camada("0-5cm", 55), camada("5-15cm", 55), camada("15-30cm", 55)] }], r);
  assert.equal(r.phh2o, 5.5);
}

// camada sem valor não vira zero: usa só as que existem
{
  const r = soloVazio();
  aplicarMediaPonderadaSolo([{ name: "clay", depths: [camada("0-5cm", 300), camada("5-15cm", null), camada("15-30cm", 500)] }], r);
  assert.equal(r.clay, 45); // (300*5 + 500*15) / 20 = 450 g/kg = 45%; a camada nula não puxa para zero
}

// propriedade desconhecida é ignorada; resposta vazia não preenche nada
{
  const r = soloVazio();
  assert.equal(aplicarMediaPonderadaSolo([{ name: "xyz", depths: [camada("0-5cm", 100)] }], r), false);
  assert.equal(aplicarMediaPonderadaSolo([], r), false);
  assert.equal(r.clay, null);
}

// ---- temperatura média: usa a média mensal, não o ponto médio dos extremos ----
const clima = (mensal: number[] | undefined, max = 36, min = 8): ClimaResult => ({
  precipitacaoMedia: 98,
  temperaturaMaxMedia: max,
  temperaturaMinMedia: min,
  fonte: "teste",
  temperaturaMensal: mensal,
});
assert.equal(temperaturaMediaAnual(clima([26, 26, 25, 24, 22, 21, 21, 23, 25, 26, 26, 26])), 24.3); // soma 291 / 12 = 24,25
// o método antigo daria (36 + 8) / 2 = 22 — fora da realidade desse clima
assert.notEqual(temperaturaMediaAnual(clima([26, 26, 25, 24, 22, 21, 21, 23, 25, 26, 26, 26])), 22);
assert.equal(temperaturaMediaAnual(clima(undefined)), 0);
assert.equal(temperaturaMediaAnual(clima([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 0);
assert.equal(temperaturaMediaAnual(clima([25, 25, 25])), 0); // série curta demais
assert.equal(temperaturaMediaAnual(null), 0);

console.log("agro-solo-clima: todos os testes passaram");
