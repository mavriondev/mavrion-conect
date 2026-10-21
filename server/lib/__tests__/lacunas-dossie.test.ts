// Testes das lacunas estruturadas (4 campos, catálogo determinístico) e do
// score de completude do dossiê — o ÚNICO indicador do relatório.
// Rodar com: npx tsx server/lib/__tests__/lacunas-dossie.test.ts
import assert from "node:assert";
import {
  avaliarComponentesMaturidade,
  gerarLacunasDossie,
  computeScoreCompletude,
  metricaCobertura,
  fraseNaoConclusivo,
  lacunaDisciplina,
} from "../lacunas-dossie";

// ── 1. Ativo não-minerário: componentes não se aplicam ──
assert.deepEqual(avaliarComponentesMaturidade({ type: "FAZENDA", camposEspecificos: {} }), []);

// ── 2. MINA sem nada: 6 componentes ausentes ⇒ 6 lacunas de 4 campos, score 0 ──
const vazio = avaliarComponentesMaturidade({ type: "MINA", camposEspecificos: {} });
assert.equal(vazio.length, 6);
assert.ok(vazio.every((c) => !c.presente));
const lac = gerarLacunasDossie(vazio);
assert.equal(lac.length, 6);
for (const l of lac) {
  assert.ok(l.oQueFalta.length > 0, "o que falta preenchido");
  assert.ok(l.porQueImporta.length > 0, "por que importa preenchido");
  assert.ok(l.ondeObter.length > 0, "onde obter vem do catálogo fixo");
  assert.ok(l.custoPrazo.length > 0, "custo e prazo vêm do catálogo fixo");
  assert.equal(l.origem, "maturidade");
}
const sc0 = computeScoreCompletude(vazio);
assert.equal(sc0.score, 0, "ativo sem nenhum componente não exibe pontuação alta");
assert.equal(sc0.presentes, 0);
assert.equal(sc0.total, 6);
assert.ok(sc0.formula.includes("100 ×"), "fórmula visível junto do score");

// ── 3. Componentes presentes com evidência, fonte e data ──
const asset = {
  type: "MINA",
  createdAt: "2026-01-01T00:00:00Z",
  camposEspecificos: {
    processoAnm: "832.070/2024",
    teor: "1,2% Cu",
    recursoEstimado: "10 Mt",
    recursoCategoria: "inferida",
    densidade: "2,7 t/m³",
    anmHistorico: {
      eventos: [{ descricao: "RELATÓRIO FINAL DE PESQUISA POSITIVO APRESENTADO", data: "01/02/2024", tipo: "outro" }],
      consultadoEm: "2026-08-01T00:00:00Z",
    },
    licencaAmbiental: "LO 123/2025",
    anmCfem: { disponivel: true, consultadoEm: "2026-08-01T00:00:00Z", processo: { jaProduziu: false, porAno: [] } },
  },
};
const comps = avaliarComponentesMaturidade(asset);
assert.equal(comps.length, 6);
assert.ok(comps.every((c) => c.presente), "todos os componentes presentes");
const rfp = comps.find((c) => c.id === "relatorioFinal")!;
assert.match(rfp.evidencia!, /RELATÓRIO FINAL/i);
assert.equal(rfp.fonte, "Eventos ANM (Cadastro Mineiro)");
assert.ok(rfp.dataConsulta, "evidência de fonte oficial carrega a data da consulta");

// resposta NEGATIVA da base CFEM também conta como componente respondido
const prod = comps.find((c) => c.id === "producaoHistorica")!;
assert.ok(prod.presente, "sem recolhimento na base coberta = pergunta respondida");
assert.match(prod.evidencia!, /[Ss]em recolhimento/);
assert.equal(prod.fonte, "CFEM/ANM (dados abertos)");

assert.equal(computeScoreCompletude(comps).score, 100);
assert.equal(gerarLacunasDossie(comps).length, 0, "componente presente não gera lacuna");

// ── 4. "Não é possível concluir" é saída de primeira classe ──
const frase = fraseNaoConclusivo("teor da substância", "análises químicas");
assert.equal(frase, "Não é possível concluir sobre teor da substância com as fontes disponíveis. Falta: análises químicas");

// ── 5. Lacuna de disciplina (enunciado descartado no reprocesso) ──
const ld = lacunaDisciplina("riscos", "vocabulário proibido persistente");
assert.equal(ld.origem, "disciplina");
assert.ok(ld.oQueFalta.includes("riscos"));
assert.ok(ld.porQueImporta.includes("vocabulário proibido persistente"));
assert.ok(ld.ondeObter.length > 0 && ld.custoPrazo.length > 0, "os 4 campos existem também na lacuna de disciplina");

// ── 6. Métrica T1/T2 vs lacunas declaradas ──
const m = metricaCobertura(4, 2);
assert.equal(m.respondidosT1T2, 4);
assert.equal(m.lacunasDeclaradas, 2);
assert.match(m.texto, /67% respondido/);
assert.match(metricaCobertura(0, 0).texto, /0% respondido/);

console.log("lacunas-dossie.test.ts OK");
