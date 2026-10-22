// O proxy /api/vps/* da Hub chama a própria Hub por HTTP local com a API key — sem SSH, sshpass ou senha.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const source = readFileSync(join(__dirname, "../src/index.cjs"), "utf8");

function helper(env, fetchMock) {
  const start = source.indexOf("  async function e(r) {", source.indexOf("function J9e(a) {"));
  const end = source.indexOf('\n  (a.get("/api/vps/altitude/status"', start);
  assert.ok(start >= 0 && end > start, "A função do proxy real precisa ser encontrada");
  // Extrai a função de produção sem inicializar o servidor; só o fetch global é substituído.
  return new Function("process", "fetch", `return (${source.slice(start, end).trim()});`)({ env }, fetchMock);
}

test("fonte da Hub não contém mais SSH/sshpass nem variáveis VPS_*", () => {
  for (const proibido of ["VPS_HOST", "VPS_USER", "VPS_PASSWORD", "sshpass -", "SSHPASS", "StrictHostKeyChecking"]) {
    assert.ok(!source.includes(proibido), `fonte ainda contém ${proibido}`);
  }
});

test("proxy chama 127.0.0.1 na porta da Hub com x-api-key e devolve o JSON", async () => {
  let call;
  const proxy = helper({ API_KEYS: "chave-apenas-de-teste,segunda-chave", PORT: "5002" }, async (url, init) => {
    call = { url, init };
    return { ok: true, status: 200, json: async () => ({ worker: { isRunning: false } }) };
  });
  const result = await proxy("/api/sicar/altitude/status");
  assert.equal(result.worker.isRunning, false);
  assert.equal(call.url, "http://127.0.0.1:5002/api/sicar/altitude/status");
  assert.equal(call.init.headers["x-api-key"], "chave-apenas-de-teste");
  assert.ok(call.init.signal instanceof AbortSignal);
});

test("sem PORT usa o mesmo default do listen (5000)", async () => {
  let url;
  const proxy = helper({ API_KEYS: "k" }, async (u) => { url = u; return { ok: true, status: 200, json: async () => ({}) }; });
  await proxy("/api/sicar/opengeohub/status");
  assert.equal(url, "http://127.0.0.1:5000/api/sicar/opengeohub/status");
});

test("sem API_KEYS falha antes de chamar a rede", async () => {
  let called = false;
  const proxy = helper({}, async () => { called = true; });
  await assert.rejects(proxy("/api/sicar/altitude/status"), /API_KEYS não configurada/);
  assert.equal(called, false);
});

test("resposta não-2xx da Hub vira erro com status", async () => {
  const proxy = helper({ API_KEYS: "k", PORT: "5002" }, async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(proxy("/api/sicar/altitude/status"), /respondeu 401/);
});
