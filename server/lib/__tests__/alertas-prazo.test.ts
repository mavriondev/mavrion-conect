// Testes do motor de alertas de prazo — DERIVADOS determinísticos das datas
// estruturadas (eventos ANM, validade cadastrada, TAH, CFEM). Data de geração
// fixa para reprodutibilidade.
// Rodar com: npx tsx server/lib/__tests__/alertas-prazo.test.ts
import assert from "node:assert";
import { calcularAlertasPrazo, parseDataFlexivel } from "../alertas-prazo";

const HOJE = new Date(2026, 7, 19); // 19/08/2026

// ── 0. parseDataFlexivel ──
assert.equal(parseDataFlexivel("10/01/2024")!.getFullYear(), 2024);
assert.equal(parseDataFlexivel("2024-01-10T00:00:00Z")!.getFullYear(), 2024);
assert.equal(parseDataFlexivel("não é data"), null);
assert.equal(parseDataFlexivel(null), null);

// ── 1. Fora de escopo: não-minerário e MINA sem datas ──
assert.deepEqual(calcularAlertasPrazo({ type: "FAZENDA", camposEspecificos: {} }, HOJE), []);
assert.deepEqual(calcularAlertasPrazo({ type: "MINA", camposEspecificos: {} }, HOJE), []);

// ── 2. Sem movimentação: >365d = atenção, >730d = crítico ──
const comEvento = (data: string) => ({
  type: "MINA",
  camposEspecificos: {
    processoAnm: "832.070/2024",
    anmHistorico: { eventos: [{ descricao: "DOCUMENTO DIVERSO PROTOCOLIZADO", data, tipo: "outro" }] },
  },
});
let alertas = calcularAlertasPrazo(comEvento("10/01/2024"), HOJE); // ~952 dias
let a = alertas.find((x) => x.id === "sem-movimentacao")!;
assert.ok(a, "alerta de sem movimentação emitido");
assert.equal(a.gravidade, "critico");
assert.equal(a.categoria, "DERIVADO");
assert.ok(a.regra.includes("365"), "regra determinística exibível");
assert.equal(a.datasFonte.length, 2, "datas-fonte exibíveis (evento + geração)");
assert.equal(a.identificador, "832.070/2024");
assert.equal(a.tier, "T1");

alertas = calcularAlertasPrazo(comEvento("10/01/2025"), HOJE); // ~586 dias
assert.equal(alertas.find((x) => x.id === "sem-movimentacao")!.gravidade, "atencao");

alertas = calcularAlertasPrazo(comEvento("10/07/2026"), HOJE); // 40 dias
assert.equal(alertas.length, 0, "movimentação recente não gera alerta");

// evento falso (descrição = número do processo) não conta como movimentação
alertas = calcularAlertasPrazo({
  type: "MINA",
  camposEspecificos: {
    processoAnm: "832.070/2024",
    anmHistorico: { eventos: [{ descricao: "832.070", data: "10/01/2020", tipo: "outro" }] },
  },
}, HOJE);
assert.ok(!alertas.some((x) => x.id === "sem-movimentacao"), "evento falso é filtrado antes da regra");

// ── 3. Validade vencida SEM sucessão ⇒ crítico ──
alertas = calcularAlertasPrazo({
  type: "MINA",
  camposEspecificos: { processoAnm: "832.070/2024", validadeAnm: "01/06/2025" },
}, HOJE);
a = alertas.find((x) => x.id === "titulo-vencido-sem-sucessao")!;
assert.ok(a, "título vencido sem sucessão emitido");
assert.equal(a.gravidade, "critico");
assert.ok(a.texto.includes("01/06/2025"));
assert.ok(a.datasFonte.some((d) => d.includes("01/06/2025")));

// ── 4. Validade vencida COM evento posterior de prorrogação ⇒ info ──
alertas = calcularAlertasPrazo({
  type: "MINA",
  camposEspecificos: {
    processoAnm: "832.070/2024",
    validadeAnm: "01/06/2025",
    anmHistorico: { eventos: [{ descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA PUBLICADA", data: "01/07/2025", tipo: "outro" }] },
  },
}, HOJE);
a = alertas.find((x) => x.id === "validade-vencida-com-evento")!;
assert.ok(a, "vencida com evento posterior vira alerta informativo");
assert.equal(a.gravidade, "info");
assert.ok(!alertas.some((x) => x.id === "titulo-vencido-sem-sucessao"));

// ── 5. Validade por vencer em ≤180 dias ⇒ atenção; além disso, nada ──
alertas = calcularAlertasPrazo({
  type: "MINA",
  camposEspecificos: { processoAnm: "832.070/2024", validadeAnm: "01/12/2026" },
}, HOJE);
a = alertas.find((x) => x.id === "validade-proxima")!;
assert.ok(a);
assert.equal(a.gravidade, "atencao");

alertas = calcularAlertasPrazo({
  type: "MINA",
  camposEspecificos: { processoAnm: "832.070/2024", validadeAnm: "01/06/2028" },
}, HOJE);
assert.equal(alertas.length, 0, "validade distante não gera alerta");

// ── 6. TAH: fase de pesquisa sem registro recente na base coberta ──
alertas = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { tah: { anoMin: 2006, anoMax: 2025 } },
  camposEspecificos: {
    processoAnm: "832.070/2024",
    faseAnm: "AUTORIZAÇÃO DE PESQUISA",
    anmTah: [{ anoBase: 2024, nomeTitular: "Titular Atual" }],
  },
}, HOJE);
a = alertas.find((x) => x.id === "tah-sem-registro-recente")!;
assert.ok(a, "TAH sem registro recente emitido");
assert.equal(a.gravidade, "atencao");
assert.ok(a.texto.includes("2025"), "aponta a faixa faltante dentro da cobertura");
assert.ok(a.regra.includes("pesquisa"));
assert.equal(a.categoria, "DERIVADO");

// sem nenhum registro de TAH (lista vazia, base coberta) ⇒ alerta próprio
alertas = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { tah: { anoMin: 2006, anoMax: 2025 } },
  camposEspecificos: { processoAnm: "832.070/2024", faseAnm: "AUTORIZAÇÃO DE PESQUISA", anmTah: [] },
}, HOJE);
assert.ok(alertas.some((x) => x.id === "tah-sem-registro"));

// fase que não é pesquisa ⇒ TAH não se aplica
alertas = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { tah: { anoMin: 2006, anoMax: 2025 } },
  camposEspecificos: { processoAnm: "832.070/2024", faseAnm: "CONCESSÃO DE LAVRA", anmTah: [] },
}, HOJE);
assert.ok(!alertas.some((x) => x.id.startsWith("tah-")), "TAH só em fase de pesquisa");

// ── 7. CFEM: produção interrompida dentro da base coberta ⇒ info ──
alertas = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { cfem: { anoMin: 2004, anoMax: 2024 } },
  camposEspecificos: {
    processoAnm: "832.070/2024",
    anmCfem: { disponivel: true, processo: { jaProduziu: true, totalRecolhido: 12345.6, porAno: [{ ano: 2019 }, { ano: 2020 }] } },
  },
}, HOJE);
a = alertas.find((x) => x.id === "cfem-sem-recolhimento-recente")!;
assert.ok(a, "CFEM interrompida emitida");
assert.equal(a.gravidade, "info");
assert.ok(a.texto.includes("2021–2024"), "faixa sem recolhimento explícita");
assert.ok(a.datasFonte.some((d) => d.includes("2020")), "último ano com recolhimento exibido");

// CFEM que nunca produziu não gera alerta de interrupção
alertas = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { cfem: { anoMin: 2004, anoMax: 2024 } },
  camposEspecificos: {
    processoAnm: "832.070/2024",
    anmCfem: { disponivel: true, processo: { jaProduziu: false, porAno: [] } },
  },
}, HOJE);
assert.ok(!alertas.some((x) => x.id === "cfem-sem-recolhimento-recente"));

// ── 8. Todo alerta é DERIVADO completo (regra + datas + fonte + id) ──
const todos = calcularAlertasPrazo({
  type: "MINA",
  __escopoBases: { tah: { anoMin: 2006, anoMax: 2025 }, cfem: { anoMin: 2004, anoMax: 2024 } },
  camposEspecificos: {
    processoAnm: "832.070/2024",
    validadeAnm: "01/06/2025",
    faseAnm: "AUTORIZAÇÃO DE PESQUISA",
    anmTah: [{ anoBase: 2024 }],
    anmHistorico: { eventos: [{ descricao: "DOCUMENTO DIVERSO PROTOCOLIZADO", data: "10/01/2024", tipo: "outro" }] },
    anmCfem: { disponivel: true, processo: { jaProduziu: true, totalRecolhido: 1, porAno: [{ ano: 2019 }] } },
  },
}, HOJE);
assert.ok(todos.length >= 4, `cenário completo emite os alertas independentes (${todos.length})`);
for (const alerta of todos) {
  assert.equal(alerta.categoria, "DERIVADO");
  assert.ok(alerta.regra.length > 0, "regra sempre exibível");
  assert.ok(alerta.datasFonte.length > 0, "datas-fonte sempre exibíveis");
  assert.ok(alerta.fonte.length > 0);
  assert.ok(alerta.tier === "T1" || alerta.tier === "T2");
}

console.log("alertas-prazo.test.ts OK");
