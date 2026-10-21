// Testes da validação da carga TAH por PARES processo+ano — rodar com:
//   npx tsx server/lib/__tests__/tah-import-validacao.test.ts
// A parte de integração usa o banco de desenvolvimento (tah_titulares) e um
// CSV fixture local via TAH_CSV_LOCAL_FILE.
import assert from "node:assert";
import { writeFileSync, rmSync } from "node:fs";

async function main() {
  const { avaliarValidacaoTah } = await import("../tah-importer");

  // ── Unitários: avaliarValidacaoTah ──

  // 1. Base prévia com cardinalidade suficiente mas pares DIFERENTES:
  //    chavesPresentes conta só os pares do CSV gravados nesta rodada, então
  //    uma base cheia de pares alheios não compensa pares faltantes.
  let r = avaliarValidacaoTah({ chavesUnicasCsv: 1000, chavesPresentes: 400, errors: 0 });
  assert.equal(r.ok, false, "pares faltantes devem reprovar mesmo com base grande");
  assert.ok(r.validacao.includes("FALHA"), "mensagem deve indicar falha");

  // 2. Falha de batch de escrita reprova sempre, mesmo com cobertura alta
  r = avaliarValidacaoTah({ chavesUnicasCsv: 1000, chavesPresentes: 1000, errors: 500 });
  assert.equal(r.ok, false, "erros de batch devem reprovar a carga");
  assert.ok(r.validacao.includes("batches"), "mensagem deve citar batches que falharam");

  // 3. CSV vazio reprova (download truncado/bloqueado pelo WAF)
  r = avaliarValidacaoTah({ chavesUnicasCsv: 0, chavesPresentes: 0, errors: 0 });
  assert.equal(r.ok, false, "CSV sem pares válidos deve reprovar");

  // 4. Cobertura completa sem erros aprova
  r = avaliarValidacaoTah({ chavesUnicasCsv: 1000, chavesPresentes: 1000, errors: 0 });
  assert.equal(r.ok, true, "cobertura total sem erros deve aprovar");

  // 5. Cobertura 99,5% (abaixo de 99,9%) reprova
  r = avaliarValidacaoTah({ chavesUnicasCsv: 1000, chavesPresentes: 995, errors: 0 });
  assert.equal(r.ok, false, "cobertura abaixo de 99,9% deve reprovar");

  // ── Integração: membership + frescor contra o banco ──
  const { db } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const { contarChavesPresentesDesde } = await import("../tah-importer");

  const PROC_STALE = "988877001"; // par que existe na base mas NÃO vem do CSV desta rodada
  const PROC_CSV = "988877002";   // par que vem do CSV desta rodada

  try {
    // Base prévia: par antigo com importado_em velho
    await db.execute(sql`DELETE FROM tah_titulares WHERE processo IN (${PROC_STALE}, ${PROC_CSV})`);
    await db.execute(sql`
      INSERT INTO tah_titulares (processo, ano_base, nome_titular, importado_em)
      VALUES (${PROC_STALE}, 1991, 'TESTE STALE', NOW() - interval '200 days')`);

    // CSV fixture com 1 par (formato real: 10 colunas, latin1 é irrelevante p/ ASCII)
    const fixture = "/tmp/tah-fixture-test.csv";
    writeFileSync(fixture,
      '"NRProcesso","NRAnoProcesso","NRCpfCnpj","NMPessoa","DSFaseProcesso","NMSuperintendencia","NRHectares","DTQuitacao","VLPago","VLTotal"\n' +
      `"${PROC_CSV}","1992","12345678000199","TESTE CSV","CONCESSÃO DE LAVRA","GER - MG","49,82","10/07/1992","300,00","300,00"\n`);

    process.env.TAH_CSV_LOCAL_FILE = fixture;
    const { importTahCsv } = await import("../tah-importer");
    const result = await importTahCsv();
    delete process.env.TAH_CSV_LOCAL_FILE;
    rmSync(fixture, { force: true });

    // 6. Só o par do CSV conta como gravado nesta rodada
    assert.equal(result.chavesUnicasCsv, 1, "fixture tem exatamente 1 par");
    assert.equal(result.chavesUnicasBanco, 1, "o par do CSV deve estar gravado nesta rodada");
    assert.ok(result.validacao.startsWith("ok"), "carga do fixture deve validar");

    // 7. O par STALE (base prévia, importado_em antigo) NÃO conta como fresco:
    //    membership por par + frescor, não cardinalidade global
    const t0res = await db.execute(sql`SELECT NOW() - interval '1 hour' AS t0`);
    const t0 = new Date((t0res.rows[0] as any).t0);
    const presentes = await contarChavesPresentesDesde([`${PROC_STALE}|1991`, `${PROC_CSV}|1992`], t0);
    assert.equal(presentes, 1, "apenas o par gravado nesta rodada deve contar (o stale fica de fora)");
  } finally {
    await db.execute(sql`DELETE FROM tah_titulares WHERE processo IN (${PROC_STALE}, ${PROC_CSV})`);
  }

  console.log("OK — todos os testes de validação TAH passaram");
  process.exit(0);
}

main().catch((e) => { console.error("FALHA:", e); process.exit(1); });
