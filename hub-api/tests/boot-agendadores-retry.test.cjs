// Garante que o boot não deixa os agendadores sem carregar quando o banco não responde no instante da subida.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const source = readFileSync(join(__dirname, "../src/index.cjs"), "utf8");

test("boot tenta de novo carregar agendadores enquanto o banco não responde", () => {
  const i = source.indexOf("let bancoPronto =");
  assert.ok(i > 0, "função bancoPronto precisa existir no bootstrap");
  const trecho = source.slice(i, i + 900);
  assert.match(trecho, /SELECT 1/);
  assert.match(trecho, /15e3/);
  assert.match(trecho, /iniciarTarefas/);
  assert.ok(!/await a\(\);\s*\n\s*let \{ autoResumeInterruptedImports/.test(source), "initScheduler não pode voltar a rodar uma única vez antes do retry");
});
