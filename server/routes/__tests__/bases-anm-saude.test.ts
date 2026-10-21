// Testes do painel de saúde das bases ANM — rodar com:
//   npx tsx server/routes/__tests__/bases-anm-saude.test.ts
// Cobre a reconciliação de rodadas órfãs: status persistido "running" sem o
// flag em memória (processo reiniciou no meio da importação) vira erro e NÃO
// trava o botão de reimportar como "rodando".
import assert from "node:assert";

async function main() {
  const { normalizeUltimaImportacao, deriveStatus } = await import("../bases-anm");

  // 1. Persistido "running" + flag vivo => continua rodando
  const vivo = normalizeUltimaImportacao({ status: "running", startedAt: "2026-08-14T03:00:00Z" }, true);
  assert.strictEqual(vivo?.status, "running");
  assert.strictEqual(deriveStatus({ running: true, total: 10, ultimaImportacao: vivo }), "rodando");

  // 2. Persistido "running" órfão (flag morto) => vira erro com detalhe
  const orfao = normalizeUltimaImportacao({ status: "running", startedAt: "2026-08-14T03:00:00Z" }, false);
  assert.strictEqual(orfao?.status, "error");
  assert.ok(orfao?.errorDetails?.includes("interrompida"));
  assert.strictEqual(deriveStatus({ running: false, total: 10, ultimaImportacao: orfao }), "erro");

  // 3. Órfão preserva errorDetails já existente
  const comDetalhe = normalizeUltimaImportacao({ status: "running", errorDetails: "detalhe original" }, false);
  assert.strictEqual(comDetalhe?.errorDetails, "detalhe original");

  // 4. Completed intacto; status derivado ok / vazia / erro
  const done = normalizeUltimaImportacao({ status: "completed", imported: 100 }, false);
  assert.strictEqual(done?.status, "completed");
  assert.strictEqual(deriveStatus({ running: false, total: 100, ultimaImportacao: done }), "ok");
  assert.strictEqual(deriveStatus({ running: false, total: 0, ultimaImportacao: null }), "vazia");
  assert.strictEqual(deriveStatus({ running: false, total: 5, ultimaImportacao: { status: "error", errorDetails: "x" } }), "erro");

  // 5. Sem status persistido nenhum
  assert.strictEqual(normalizeUltimaImportacao(null, false), null);

  // ── Integração: restart simulado com status "running" persistido ──
  // Grava um status "running" órfão em import_status (como se o processo
  // tivesse morrido no meio da rodada), reconcilia e confere que o erro foi
  // PERSISTIDO — não só transformado na resposta.
  const { reconcileUltimaImportacao } = await import("../bases-anm");
  const { saveImportStatus, getImportStatus } = await import("../../lib/import-status");
  const FONTE = "__test_bases_anm_saude";
  try {
    await saveImportStatus(FONTE, { status: "running", startedAt: "2026-08-14T03:00:00Z", imported: 0 });

    // "Restart": lê o persistido (memória do processo se perdeu) e reconcilia
    const persisted = await getImportStatus<any>(FONTE);
    assert.strictEqual(persisted?.status, "running");
    const reconciled = await reconcileUltimaImportacao(FONTE, persisted, false);
    assert.strictEqual(reconciled?.status, "error");

    const after = await getImportStatus<any>(FONTE);
    assert.strictEqual(after?.status, "error", "reconciliação deve ser persistida em import_status");
    assert.ok(after?.errorDetails?.includes("interrompida"));
    assert.ok(after?.finishedAt, "erro reconciliado precisa de finishedAt para os getters não sintetizarem completed");

    // Rodada realmente viva não é tocada
    await saveImportStatus(FONTE, { status: "running", startedAt: "2026-08-14T03:00:00Z" });
    await reconcileUltimaImportacao(FONTE, await getImportStatus<any>(FONTE), true);
    assert.strictEqual((await getImportStatus<any>(FONTE))?.status, "running");
  } finally {
    const { db } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM import_status WHERE fonte = ${FONTE}`);
  }

  console.log("bases-anm-saude.test.ts: OK");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
