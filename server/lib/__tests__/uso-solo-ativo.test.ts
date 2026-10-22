import assert from "node:assert/strict";
import { verificarMapBiomas, type AtivoGeo } from "../verificacoes-terra";
import { apresentarUsoSolo } from "../uso-solo-amostragem";
import { projecaoPublica } from "../confianca-dados";

// Uma única fazenda de teste controlada. Não escreve no banco nem dispara outras verificações.
const ativo: AtivoGeo = {
  id: 1, carCodImovel: null, lat: -16, lon: -48,
  bbox: { minLat: -16.01, minLon: -48.01, maxLat: -15.99, maxLon: -47.99 },
  geojson: { type: "Polygon", coordinates: [[
    [-48.01, -16.01], [-47.99, -16.01], [-47.99, -15.99], [-48.01, -15.99], [-48.01, -16.01],
  ]] },
};
let consulta = 0;
const pontosVistos: number[] = [];
const respostaCentral = {
  usoAtual: "Pastagem", historico: [{ ano: 2024 }], alertasConsultados: true,
  alertasDesmatamento: 0, alertasEscopo: "regiao",
} as any;
const fontes = {
  getUsoTerraMapBiomas: async (lat: number, lon: number) => {
    assert.equal(lat, ativo.lat);
    assert.equal(lon, ativo.lon);
    return respostaCentral;
  },
  classesDeUsoNosPontos: async (pontos: Array<[number, number]>) => {
    consulta++;
    pontosVistos.push(pontos.length);
    assert.ok(pontos.length >= 4);
    const classes = consulta === 1
      ? pontos.map((_, i) => i < pontos.length / 8 ? 3 : 15)
      : pontos.map((_, i) => i < 3 ? 15 : null);
    return { classes, ano: 2024 };
  },
};
const resultado = await verificarMapBiomas(ativo, fontes);
const uso = resultado.find(v => v.chave === "uso_solo")!;
assert.equal(uso.estado, "indicado");
const valor = uso.valor as any;
assert.equal(valor.metodo, "amostragem_pontos");
assert.equal(valor.amostrasTotal, pontosVistos[0]);
assert.equal(valor.ano, 2024);
assert.equal(Object.values<number>(valor.grupos).reduce((s, p) => s + p, 0), 100);
assert.equal(valor.grupos.pastagem, 85);
assert.equal(valor.grupos.vegetacao_nativa, 15);
assert.match(uso.observacao!, /Não é área medida/);
assert.match(apresentarUsoSolo(valor).texto, /85% pastagem/);
assert.match(projecaoPublica(resultado)[0].texto, /não área medida/);

// Mesmo ativo, agora sem respostas suficientes: só classe pontual, nenhum percentual.
const insuficiente = (await verificarMapBiomas(ativo, fontes)).find(v => v.chave === "uso_solo")!;
assert.equal(insuficiente.valor, "Pastagem");
assert.match(insuficiente.observacao!, /Amostra insuficiente/);
assert.doesNotMatch(apresentarUsoSolo(insuficiente.valor).texto, /%/);
const falha = (await verificarMapBiomas(ativo, { ...fontes, getUsoTerraMapBiomas: async () => null }))
  .find(v => v.chave === "uso_solo")!;
assert.equal(falha.estado, "sem_dado");
assert.equal(falha.valor, null);
assert.equal(consulta, 2);
const publicoLegado = projecaoPublica([{ ...uso, valor: { grupos: { pastagem: 90, vegetacao_nativa: 15 }, descricao: "105%" } }]);
assert.doesNotMatch(publicoLegado[0].texto, /105%|90%|15%/);
assert.match(publicoLegado[0].texto, /Atualize este ativo/);
console.log("uso-solo-ativo: um ativo controlado, sem escrita nem recálculo global; proporção, fallback e falha passaram");
