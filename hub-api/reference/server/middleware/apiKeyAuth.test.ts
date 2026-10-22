// Testes de integração do middleware de autenticação da Hub API:
// - JWT assinado com o segredo ANTIGO (exposto/rotacionado) deve ser rejeitado (401)
// - JWT assinado com o SESSION_SECRET atual deve passar (next())
// - sem token e sem API key → 401; API key válida → next()
// Rodar: npx tsx --test hub-api/reference/server/middleware/apiKeyAuth.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { apiKeyAuth } from "./apiKeyAuth";

const CURRENT_SECRET = "test-current-secret";
const OLD_LEAKED_SECRET = "mavrion-jwt-secret-2026";

function run(headers: Record<string, any>) {
  process.env.SESSION_SECRET = CURRENT_SECRET;
  process.env.API_KEYS = "test-key-abc";
  let statusCode: number | null = null;
  let nextCalled = false;
  const req: any = { headers, query: {} };
  const res: any = {
    status(c: number) { statusCode = c; return this; },
    json(_b: any) { return this; },
  };
  apiKeyAuth(req, res, () => { nextCalled = true; });
  return { statusCode, nextCalled, req };
}

test("JWT assinado com o segredo antigo exposto é rejeitado com 401", () => {
  const oldToken = jwt.sign({ userId: 1, username: "atacante" }, OLD_LEAKED_SECRET, { expiresIn: "7d" });
  const r = run({ authorization: `Bearer ${oldToken}` });
  assert.equal(r.statusCode, 401);
  assert.equal(r.nextCalled, false);
});

test("JWT assinado com o SESSION_SECRET atual passa e popula req.user", () => {
  const goodToken = jwt.sign({ userId: 2, username: "rotina" }, CURRENT_SECRET, { expiresIn: "1h" });
  const r = run({ authorization: `Bearer ${goodToken}` });
  assert.equal(r.statusCode, null);
  assert.equal(r.nextCalled, true);
  assert.equal(r.req.user.username, "rotina");
});

test("JWT expirado é rejeitado com 401", () => {
  const expired = jwt.sign({ userId: 3 }, CURRENT_SECRET, { expiresIn: -10 });
  const r = run({ authorization: `Bearer ${expired}` });
  assert.equal(r.statusCode, 401);
});

test("sem token e sem API key → 401; API key válida → passa; inválida → 401", () => {
  assert.equal(run({}).statusCode, 401);
  assert.equal(run({ "x-api-key": "test-key-abc" }).nextCalled, true);
  assert.equal(run({ "x-api-key": "mavrion-connect-key-2026" }).statusCode, 401);
});
