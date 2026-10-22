const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { promisify } = require("node:util");

function helper(env, exec) {
  const source = readFileSync(join(__dirname, "../src/index.cjs"), "utf8");
  const start = source.indexOf("  async function e(r) {", source.indexOf("function J9e(a) {"));
  const end = source.indexOf('\n  (a.get("/api/vps/altitude/status"', start);
  assert.ok(start >= 0 && end > start, "A função SSH real precisa ser encontrada");
  // Extrai a função de produção sem inicializar o servidor nem seus agendadores.
  // Só o carregamento dos módulos é substituído, para capturar o processo filho.
  const load = async name => {
    if (name === "child_process") return { exec };
    if (name === "util") return { promisify };
    throw new Error(`Módulo inesperado: ${name}`);
  };
  return new Function("process", "load",
    `return (${source.slice(start, end).trim().replaceAll("import(", "load(")});`
  )({ env }, load);
}

test("SSH usa sshpass -e e preserva senha com aspas só em SSHPASS", async () => {
  const password = "senha-ficticia'com\"aspas $e; espaços";
  const env = { VPS_HOST: "vps.example.invalid", VPS_USER: "teste", VPS_PASSWORD: password,
    API_KEYS: "chave-apenas-de-teste", PRESERVAR: "sim" };
  let call;
  const ssh = helper(env, (command, options, callback) => {
    call = { command, options };
    callback(null, { stdout: '{"worker":{"isRunning":false}}' });
  });
  const result = await ssh("/api/sicar/altitude/status");
  assert.equal(result.worker.isRunning, false);
  assert.match(call.command, /^sshpass -e ssh /);
  assert.ok(!call.command.includes("sshpass -p"));
  assert.ok(!call.command.includes(password));
  assert.equal(call.options.env.SSHPASS, password);
  assert.equal(call.options.env.PRESERVAR, "sim");
  assert.equal(call.options.timeout, 15000);
  assert.equal(env.SSHPASS, undefined, "Não modifica o ambiente do processo pai");
});

test("VPS sem configuração falha antes de executar SSH", async () => {
  let called = false;
  const ssh = helper({}, () => { called = true; });
  await assert.rejects(ssh("/api/sicar/altitude/status"), /VPS não configurado/);
  assert.equal(called, false);
});
