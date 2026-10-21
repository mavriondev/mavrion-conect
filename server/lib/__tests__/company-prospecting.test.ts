import test from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { discardCompanyRecord, getCompanyProspectionState } from "../company-prospecting";
import { readFileSync } from "node:fs";

function fixture() {
  const rows = [
    { id: 10, orgId: 1, cnpj: "11111111000111", enrichmentData: { preserved: "evidence" } as Record<string, unknown> },
    { id: 20, orgId: 2, cnpj: "22222222000122", enrichmentData: {} as Record<string, unknown> },
  ];
  const dialect = new PgDialect();
  const db = {
    select: () => ({ from: () => ({
      where: async (condition: SQL) => {
        const query = dialect.sqlToQuery(condition);
        assert.match(query.sql, /"companies"\."org_id" = \$1/);
        return rows.filter(row => row.orgId === query.params[0]).map(row => ({ ...row }));
      },
    }) }),
    update: () => ({ set: () => ({
      where: (condition: SQL) => ({ returning: async () => {
        const query = dialect.sqlToQuery(condition);
        assert.match(query.sql, /"org_id" = \$1/);
        assert.match(query.sql, /"cnpj" = \$2/);
        const matches = rows.filter(row => row.orgId === query.params[0] && row.cnpj === query.params[1]);
        for (const row of matches) row.enrichmentData = { ...row.enrichmentData, prospeccaoDescartada: true };
        return matches.map(row => ({ id: row.id }));
      } }),
    }) }),
  } as unknown as NodePgDatabase<any>;
  return { db, rows };
}

test("descarte não altera empresa de outra organização", async () => {
  const { db, rows } = fixture();
  assert.equal(await discardCompanyRecord(db, 1, rows[1].cnpj), null);
  assert.deepEqual(rows[1].enrichmentData, {});
});

test("descarte persiste em nova pesquisa sem apagar evidências existentes", async () => {
  const { db, rows } = fixture();
  const before = await getCompanyProspectionState(db, 1);
  assert.equal(before.discardedCnpjs.has(rows[0].cnpj), false);
  assert.deepEqual(await discardCompanyRecord(db, 1, rows[0].cnpj), { id: 10 });
  const after = await getCompanyProspectionState(db, 1);
  assert.equal(after.discardedCnpjs.has(rows[0].cnpj), true);
  assert.equal(rows[0].enrichmentData.preserved, "evidence");
});

test("estado de pesquisa e descarte não vaza entre organizações", async () => {
  const { db, rows } = fixture();
  await discardCompanyRecord(db, 1, rows[0].cnpj);
  const other = await getCompanyProspectionState(db, 2);
  assert.equal(other.savedCnpjMap.has(rows[0].cnpj), false);
  assert.equal(other.discardedCnpjs.has(rows[0].cnpj), false);
  assert.equal(other.savedCnpjMap.get(rows[1].cnpj), 20);
});

test("todas as buscas aplicam estado de descarte carregado por organização", () => {
  const source = readFileSync("server/routes/prospeccao.ts", "utf8");
  assert.equal((source.match(/await getCompanyProspectionState\(db, getOrgId\(req\)\)/g) || []).length, 3);
  for (const name of ["enrichedResults", "resultsWithEstimate", "results"]) {
    assert.ok(source.includes(`${name}.filter`), name);
  }
});
