// Teste de isolamento multi-tenant da rota POST /api/anm/backfill-municipios.
// Rodar com o servidor de dev ativo: npx tsx server/lib/__tests__/anm-backfill-tenant.test.ts
//
// Prova que um admin de uma organização NÃO vê nem atualiza ativos ANM
// pendentes de outra organização.
import assert from "node:assert";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scryptAsync = promisify(scrypt);
const BASE = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const suffix = Date.now();
  const password = randomBytes(12).toString("hex");
  let orgBId: number | null = null;
  let userBId: number | null = null;
  let assetAId: number | null = null;

  try {
    // Org B + admin da Org B
    const orgRes = await db.query(
      `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
      [`Org Teste Tenant ${suffix}`],
    );
    orgBId = orgRes.rows[0].id;
    const userRes = await db.query(
      `INSERT INTO users (org_id, username, password, role) VALUES ($1, $2, $3, 'admin') RETURNING id`,
      [orgBId, `tenant_test_${suffix}`, await hashPassword(password)],
    );
    userBId = userRes.rows[0].id;

    // Ativo ANM pendente (sem município) na Org A (id=1) — processo fictício
    const assetRes = await db.query(
      `INSERT INTO assets (org_id, type, title, estado, municipio, anm_processo)
       VALUES (1, 'MINA', 'Ativo tenant-test A', 'MG', NULL, $1) RETURNING id`,
      [`999999/${suffix % 10000}`],
    );
    assetAId = assetRes.rows[0].id;

    // Login como admin da Org B
    const loginResp = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: `tenant_test_${suffix}`, password }),
    });
    assert.strictEqual(loginResp.status, 200, "login do admin da Org B deve funcionar");
    const cookie = loginResp.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "sessão deve retornar cookie");

    // Chama o backfill como admin da Org B
    const bfResp = await fetch(`${BASE}/api/anm/backfill-municipios`, {
      method: "POST",
      headers: { Cookie: cookie! },
    });
    assert.strictEqual(bfResp.status, 200, "rota deve responder 200 para admin");
    const body = (await bfResp.json()) as any;

    // Não pode enumerar nem tocar no ativo pendente da Org A
    const ids = (body.resultados || []).map((r: any) => r.id);
    assert.ok(!ids.includes(assetAId), "resposta não pode listar ativo de outra organização");
    assert.strictEqual(body.total, 0, "Org B não tem ativos pendentes; total deve ser 0");

    // Ativo da Org A permanece intocado
    const check = await db.query(`SELECT municipio, location FROM assets WHERE id = $1`, [assetAId]);
    assert.strictEqual(check.rows[0].municipio, null, "município do ativo da Org A não pode ser alterado");

    console.log("OK — backfill ANM respeita isolamento multi-tenant (admin de Org B não vê/atualiza ativos da Org A)");
  } finally {
    if (assetAId) await db.query(`DELETE FROM assets WHERE id = $1`, [assetAId]);
    if (userBId) await db.query(`DELETE FROM users WHERE id = $1`, [userBId]);
    if (orgBId) await db.query(`DELETE FROM organizations WHERE id = $1`, [orgBId]);
    await db.end();
  }
}

main().catch((err) => {
  console.error("FALHOU:", err.message);
  process.exit(1);
});
