// Testes da camada de enunciados classificados (disciplina de certeza):
// destino por categoria/tier, vocabulário proibido (acento/caixa/flexão),
// passo adversarial que SÓ remove e detector de conflitos entre fontes.
// Rodar com: npx tsx server/lib/__tests__/enunciados.test.ts
import assert from "node:assert";
import {
  destinoEnunciado,
  detectarVocabularioProibido,
  VOCABULARIO_PROIBIDO,
  passoAdversarial,
  detectarConflitos,
  fonteVaga,
  type Enunciado,
} from "../enunciados";

// ── 1. Regras de publicação por categoria/tier ──
assert.equal(destinoEnunciado({ categoria: "FATO", tier: "T1" }), "corpo");
assert.equal(destinoEnunciado({ categoria: "DERIVADO", tier: "T2" }), "corpo");
assert.equal(destinoEnunciado({ categoria: "FATO", tier: "T3" }), "anexo", "T3 vai para anexo, nunca corpo");
assert.equal(destinoEnunciado({ categoria: "HIPOTESE", tier: "T1" }), "hipoteses", "hipótese nunca entra no corpo");
assert.equal(destinoEnunciado({ categoria: "FATO", tier: "T4" }), "hipoteses", "T4 (busca web) nunca entra no corpo");
assert.equal(destinoEnunciado({ categoria: "DERIVADO", tier: "T4" }), "hipoteses");

// ── 2. Vocabulário proibido: caixa, acento e flexão ──
assert.deepEqual(detectarVocabularioProibido("O processo está ativo desde 2024."), []);
assert.ok(detectarVocabularioProibido("Possivelmente há reserva").includes("possivelmente"));
assert.ok(detectarVocabularioProibido("os valores ESTIMAM-SE altos").includes("estima-se"));
assert.ok(detectarVocabularioProibido("costumam ocorrer atrasos").includes("costuma"), "flexão 'costumam' detectada");
assert.ok(detectarVocabularioProibido("tendem a valorizar").includes("tende a"), "flexão 'tendem a' detectada");
assert.ok(detectarVocabularioProibido("nao se descartam riscos").includes("não se descarta"), "sem acento também detecta");
assert.ok(detectarVocabularioProibido("Em tese, o título vale").includes("em tese"));
// fronteira de palavra: não dispara dentro de outra palavra
assert.deepEqual(detectarVocabularioProibido("registro sinteticamente correto"), []);
assert.equal(VOCABULARIO_PROIBIDO.length, 17, "lista canônica completa");

// ── 3. Passo adversarial: única operação é REMOVER, com motivo registrado ──
const base: Enunciado = {
  categoria: "FATO",
  tier: "T1",
  texto: "Processo 832.070/2024 em fase de REQUERIMENTO DE LAVRA.",
  fonte: "SCM/ANM",
  dataConsulta: "2026-08-10",
  identificador: "832.070/2024",
  origem: "sintese",
};
let r = passoAdversarial([base]);
assert.equal(r.mantidas.length, 1);
assert.equal(r.remocoes.length, 0);
assert.equal(r.mantidas[0].texto, base.texto, "nunca reescreve: texto idêntico");

r = passoAdversarial([{ ...base, fonte: null }]);
assert.equal(r.mantidas.length, 0);
assert.match(r.remocoes[0].motivo, /fonte/);
assert.equal(r.remocoes[0].origem, "sintese", "remoção registra a origem");

r = passoAdversarial([{ ...base, dataConsulta: null }]);
assert.match(r.remocoes[0].motivo, /data/);

r = passoAdversarial([{ ...base, identificador: null }]);
assert.match(r.remocoes[0].motivo, /identificador/, "FATO sem identificador cai");

r = passoAdversarial([{ ...base, categoria: "DERIVADO", identificador: null, insumos: ["F1"], regra: "regra x" }]);
assert.equal(r.mantidas.length, 1, "DERIVADO pode se ancorar nos insumos");

r = passoAdversarial([{ ...base, categoria: "DERIVADO", regra: null }]);
assert.match(r.remocoes[0].motivo, /regra/, "DERIVADO sem regra exibível cai");

r = passoAdversarial([{ ...base, texto: "Provavelmente há minério na área." }]);
assert.match(r.remocoes[0].motivo, /vocabulário proibido/);

r = passoAdversarial(
  [{ ...base, texto: "O processo nunca recolheu CFEM." }],
  [{ descricao: "base CFEM registra recolhimentos", padrao: /nunca recolheu/ }],
);
assert.match(r.remocoes[0].motivo, /contradiz/, "contradição com campo estruturado cai");

r = passoAdversarial([{ ...base, fonte: "busca web" }]);
assert.match(r.remocoes[0].motivo, /vaga/, "fonte vaga não é conferível em <1 min");

r = passoAdversarial([{ ...base, tier: "T3" }]);
assert.match(r.remocoes[0].motivo, /não publicável/, "T3 não entra no corpo");

assert.ok(fonteVaga("busca web") && fonteVaga("") && !fonteVaga("SCM/ANM"));

// ── 4. Conflitos entre campos estruturados: exibir ambos, nunca escolher ──
assert.equal(detectarConflitos([
  { grandeza: "Área (ha)", tipo: "numero", valores: [{ valor: 49.2, fonte: "SCM" }, { valor: "49,2", fonte: "SIGMINE" }] },
]).length, 0, "mesmo número em formatos pt-BR diferentes não conflita");

const confArea = detectarConflitos([
  { grandeza: "Área (ha)", tipo: "numero", valores: [{ valor: 49.2, fonte: "SCM" }, { valor: 62.15, fonte: "SIGMINE" }] },
]);
assert.equal(confArea.length, 1);
assert.equal(confArea[0].valores.length, 2, "ambos os valores ficam exibidos");
assert.ok(confArea[0].valores.some((v) => v.fonte === "SCM") && confArea[0].valores.some((v) => v.fonte === "SIGMINE"));

assert.equal(detectarConflitos([
  { grandeza: "Área (ha)", tipo: "numero", valores: [{ valor: 100, fonte: "a" }, { valor: 101, fonte: "b" }] },
]).length, 0, "diferença de 1% fica dentro da tolerância de 2%");

assert.equal(detectarConflitos([
  { grandeza: "Substância", tipo: "texto", valores: [{ valor: "AREIA", fonte: "a" }, { valor: "Areia industrial", fonte: "b" }] },
]).length, 0, "contenção textual não é conflito");

assert.equal(detectarConflitos([
  { grandeza: "Titular", tipo: "texto", valores: [{ valor: "EMPRESA A LTDA", fonte: "SCM" }, { valor: "EMPRESA B SA", fonte: "SIGMINE" }] },
]).length, 1, "titulares diferentes conflitam");

assert.equal(detectarConflitos([
  { grandeza: "UF", tipo: "texto", valores: [{ valor: "MG", fonte: "SCM" }] },
]).length, 0, "valor único nunca conflita");

console.log("enunciados.test.ts OK");
