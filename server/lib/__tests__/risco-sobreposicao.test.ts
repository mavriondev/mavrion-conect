import assert from "node:assert/strict";
import { calcularRiscoSobreposicao } from "../due-diligence-fundiaria";

const ok = { terraIndigena: "consultada", quilombola: "consultada", unidadeConservacao: "consultada", assentamento: "nao_configurada" } as const;
const area = (nivelRisco: "alto" | "medio") => ({ nome: "x", tipo: "UC" as const, percentualSobreposicao: 0, areaIntersecaoHa: 0, nivelRisco });
const vazio = { terrasIndigenas: [], quilombolas: [], unidadesConservacao: [] };

// tudo consultado e vazio → nenhum (assentamento "não configurada" não bloqueia)
assert.equal(calcularRiscoSobreposicao({ ...vazio, camadas: { ...ok } }), "nenhum");
// camada falhou e nada achado → indeterminado (falha não é ausência)
assert.equal(calcularRiscoSobreposicao({ ...vazio, camadas: { ...ok, quilombola: "falhou" } }), "indeterminado");
// achado positivo vale mesmo com outra camada falhando
assert.equal(calcularRiscoSobreposicao({ ...vazio, quilombolas: [area("alto")], camadas: { ...ok, terraIndigena: "falhou" } }), "alto");
assert.equal(calcularRiscoSobreposicao({ ...vazio, unidadesConservacao: [area("medio")], camadas: { ...ok } }), "medio");
assert.equal(calcularRiscoSobreposicao({ ...vazio, unidadesConservacao: [area("alto")], camadas: { ...ok } }), "alto");
assert.equal(calcularRiscoSobreposicao({ ...vazio, assentamentos: [area("alto")], camadas: { ...ok } }), "alto");
console.log("risco-sobreposicao: todos os testes passaram");
