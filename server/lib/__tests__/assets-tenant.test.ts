import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IStorage } from "../../storage";
import { registerAssetRoutes } from "../../routes/assets";

let server: Server;
let baseUrl: string;
const created: any[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  // Auth is simulated only inside this isolated test server, never in the app.
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => req.headers["x-test-org"] !== undefined) as any;
    req.user = { orgId: Number(req.headers["x-test-org"]) } as any;
    next();
  });
  const storage = {
    getAsset: async (id: number) => id === 11 ? { id, orgId: 1, type: "JAZIDA", title: "Fixture" } : undefined,
    createAsset: async (input: any) => {
      created.push(input);
      return { ...input, id: 12 };
    },
  } as unknown as IStorage;
  registerAssetRoutes(app, storage, {} as any);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server.close(); });

test("leitura do ativo só permite a organização da sessão", async () => {
  const own = await fetch(`${baseUrl}/api/assets/11`, { headers: { "x-test-org": "1" } });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).orgId, 1);
  const other = await fetch(`${baseUrl}/api/assets/11`, { headers: { "x-test-org": "2" } });
  const missing = await fetch(`${baseUrl}/api/assets/999`, { headers: { "x-test-org": "2" } });
  assert.equal(other.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await other.json(), await missing.json());
});

test("cadastro ignora orgId forjado e usa a organização autenticada", async () => {
  for (const forged of [1, null, "outra-organizacao"]) {
    const response = await fetch(`${baseUrl}/api/assets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-org": "2" },
      body: JSON.stringify({ type: "JAZIDA", title: "Fixture isolada", orgId: forged }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).orgId, 2);
    assert.equal(created.at(-1).orgId, 2);
  }
});

test("leitura e cadastro exigem autenticação sem escrever no storage", async () => {
  const count = created.length;
  assert.equal((await fetch(`${baseUrl}/api/assets/11`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "JAZIDA", title: "Não criar", orgId: 1 }),
  })).status, 401);
  assert.equal(created.length, count);
});
