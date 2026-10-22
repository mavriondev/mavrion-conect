import assert from "node:assert/strict";
import {
  verificacaoAutomatica, confirmarVerificacao, escolherVigente, estaVencida, projecaoPublica, rotuloEstado,
} from "../confianca-dados";

// consulta que falhou → sem_dado, nunca "nao_detectado"
const falhou = verificacaoAutomatica({ chave: "sobreposicao_ti", achado: "indeterminado", valor: 123, fonte: "FUNAI" });
assert.equal(falhou.estado, "sem_dado");
assert.equal(falhou.valor, null);

// não detectado → indicado, com aviso de que não prova ausência
const nd = verificacaoAutomatica({ chave: "sobreposicao_uc", achado: "nao_detectado", fonte: "ICMBio" });
assert.equal(nd.estado, "indicado");
assert.match(nd.observacao || "", /não confirma ausência/);

// automática nunca vira "confirmado"
assert.notEqual(verificacaoAutomatica({ chave: "ndvi", achado: "detectado", valor: 0.5, fonte: "S2" }).estado, "confirmado");

// confirmação humana exige origem válida e achado
assert.throws(() => confirmarVerificacao(null, { chave: "uso_solo", achado: "detectado", confirmadoPor: "robo" as any }));
assert.throws(() => confirmarVerificacao(null, { chave: "uso_solo", achado: "indeterminado", confirmadoPor: "visita" }));
const conf = confirmarVerificacao(nd, { chave: "sobreposicao_uc", achado: "nao_detectado", confirmadoPor: "documento" });
assert.equal(conf.estado, "confirmado");
assert.equal(rotuloEstado(conf), "Confirmado (documento)");

// automática nova não sobrescreve confirmação humana
const novaAuto = verificacaoAutomatica({ chave: "sobreposicao_uc", achado: "detectado", fonte: "ICMBio" });
assert.equal(escolherVigente(conf, novaAuto), conf);
assert.equal(escolherVigente(null, novaAuto), novaAuto);

// validade
const velha = { ...nd, consultadoEm: new Date(Date.now() - 400 * 86400000).toISOString() };
assert.equal(estaVencida(velha), true);
assert.equal(estaVencida(nd), false);
assert.equal(estaVencida({ ...conf, consultadoEm: velha.consultadoEm }), false);

// projeção pública: só positivos permitidos, faixas, sem sobreposição
const pub = projecaoPublica([
  verificacaoAutomatica({ chave: "logistica_rodovia", achado: "detectado", valor: 12500, fonte: "IBGE" }),
  verificacaoAutomatica({ chave: "ndvi", achado: "detectado", valor: 0.67, fonte: "S2" }),
  verificacaoAutomatica({ chave: "sobreposicao_ti", achado: "detectado", valor: "Terra X", fonte: "FUNAI" }),
  verificacaoAutomatica({ chave: "logistica_ferrovia", achado: "indeterminado", fonte: "IBGE" }),
  verificacaoAutomatica({ chave: "uso_solo", achado: "nao_detectado", fonte: "MapBiomas" }),
]);
assert.deepEqual(pub.map((p) => p.chave).sort(), ["logistica_rodovia", "ndvi"]);
assert.equal(pub.find((p) => p.chave === "logistica_rodovia")!.texto, "de 5 a 15 km");
assert.ok(!JSON.stringify(pub).includes("12500"));
console.log("confianca-dados: todos os testes passaram");
