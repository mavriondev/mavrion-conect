// Testes da rota POST /api/auth/refresh da Hub API:
// - token válido → 200 com token novo (mais 7 dias) verificável com o secret atual
// - token expirado → 401 (fluxo de re-login manual permanece)
// - token malformado/assinatura inválida → 401 (nunca 500)
// - usuário inativo/inexistente → 401
// - sem header Authorization → 401
// Rodar: DATABASE_URL=postgres://x:x@localhost/x SESSION_SECRET=test-current-secret \
//        npx tsx --test hub-api/reference/server/routes/auth.refresh.test.ts
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:5432/test";
process.env.SESSION_SECRET = "test-current-secret";

import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET!;
// imports dinâmicos: garantem que SESSION_SECRET/DATABASE_URL acima já estejam
// definidos quando auth.ts lê o secret no load do módulo
const { pool } = await import("../db");
const { registerAuthRoutes } = await import("./auth");

// Coleta os handlers registrados sem subir um servidor Express
const routes: Record<string, Function> = {};
const fakeApp: any = {
  post: (path: string, ...handlers: Function[]) => { routes[`POST ${path}`] = handlers[handlers.length - 1]; },
  get: (path: string, ...handlers: Function[]) => { routes[`GET ${path}`] = handlers[handlers.length - 1]; },
};
registerAuthRoutes(fakeApp);

// Mock do banco: por padrão devolve o usuário admin ativo
let dbRows: any[] = [{ id: 1, username: "admin", name: "Administrador" }];
(pool as any).query = async () => ({ rows: dbRows });

async function callRefresh(authorization?: string) {
  let statusCode = 200;
  let body: any = null;
  const req: any = { headers: authorization ? { authorization } : {} };
  const res: any = {
    status(c: number) { statusCode = c; return this; },
    json(b: any) { body = b; return this; },
  };
  await routes["POST /api/auth/refresh"](req, res);
  return { statusCode, body };
}

test("token válido → 200 com token novo de mais 7 dias", async () => {
  dbRows = [{ id: 1, username: "admin", name: "Administrador" }];
  const tok = jwt.sign({ userId: 1, username: "admin", name: "Administrador" }, SECRET, { expiresIn: "1d" });
  const r = await callRefresh(`Bearer ${tok}`);
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.token);
  const p: any = jwt.verify(r.body.token, SECRET); // assinado com o secret atual
  const dias = (p.exp * 1000 - Date.now()) / 86400000;
  assert.ok(dias > 6.9 && dias <= 7.01, `esperava ~7 dias, veio ${dias}`);
  assert.equal(r.body.user.username, "admin");
});

test("token expirado → 401", async () => {
  const expired = jwt.sign({ userId: 1, username: "admin" }, SECRET, { expiresIn: -10 });
  const r = await callRefresh(`Bearer ${expired}`);
  assert.equal(r.statusCode, 401);
});

test("token malformado ou assinatura inválida → 401 (não 500)", async () => {
  assert.equal((await callRefresh("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.invalid")).statusCode, 401);
  const otherSecret = jwt.sign({ userId: 1 }, "outro-secret", { expiresIn: "1d" });
  assert.equal((await callRefresh(`Bearer ${otherSecret}`)).statusCode, 401);
});

test("usuário inativo/inexistente → 401", async () => {
  dbRows = [];
  const tok = jwt.sign({ userId: 99, username: "sumido" }, SECRET, { expiresIn: "1d" });
  const r = await callRefresh(`Bearer ${tok}`);
  assert.equal(r.statusCode, 401);
  dbRows = [{ id: 1, username: "admin", name: "Administrador" }];
});

test("sem Authorization → 401", async () => {
  assert.equal((await callRefresh()).statusCode, 401);
});
