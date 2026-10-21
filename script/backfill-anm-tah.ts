/**
 * Backfill — Task: limpar dados de TAH legados salvos em camposEspecificos.anmTah
 *
 * Ativos consultados antes da correção do casamento por número COMPLETO do
 * processo (número + ano) guardam anmTah no formato legado: um array com
 * titulares de VÁRIOS anos (números-base são reutilizados entre anos por
 * processos distintos). Este script regrava o campo no formato novo
 * ({ registros, ambiguo }), filtrado pelo ano do processo (processoAnm),
 * usando o mesmo helper puro do relatório (filtrarTahPorProcesso) e o merge
 * atômico storage.mergeAssetCampos — sem reconsultar a ANM.
 *
 * Uso:
 *   npx tsx script/backfill-anm-tah.ts            # aplica
 *   npx tsx script/backfill-anm-tah.ts --dry-run  # só mostra o que faria
 */
import { db, pool } from "../server/db";
import { storage } from "../server/storage";
import { sql } from "drizzle-orm";
import { filtrarTahPorProcesso } from "../server/lib/relatorio-vinculos";

const dryRun = process.argv.includes("--dry-run");

export interface LegacyTahRow {
  id: number;
  title: string | null;
  anm_processo: string | null;
  attrs_anm_processo: string | null;
  processo_anm: string | null;
  anm_tah: any[];
}

/**
 * Mesma cadeia de fallback do processo ANM usada pelos consumidores
 * (UI/relatório): camposEspecificos.processoAnm → attributesJson.anmProcesso
 * → assets.anmProcesso.
 */
export function resolveProcesso(row: Pick<LegacyTahRow, "processo_anm" | "attrs_anm_processo" | "anm_processo">): string | null {
  return row.processo_anm || row.attrs_anm_processo || row.anm_processo || null;
}

/** Calcula o novo valor de anmTah ({ registros, ambiguo }) a partir do array legado. */
export function computeTahBackfillPatch(row: LegacyTahRow): {
  processo: string | null;
  registros: any[];
  ambiguo: boolean;
  motivo?: string;
} {
  const processo = resolveProcesso(row);
  const legado: any[] = Array.isArray(row.anm_tah) ? row.anm_tah : [];
  const vinculo = filtrarTahPorProcesso(legado, processo);
  return { processo, registros: vinculo.rows, ambiguo: vinculo.ambiguo, motivo: vinculo.motivo };
}

async function main() {
  const result = await db.execute(sql`
    SELECT id,
           title,
           anm_processo,
           attributes_json->>'anmProcesso' AS attrs_anm_processo,
           campos_especificos->>'processoAnm' AS processo_anm,
           campos_especificos->'anmTah' AS anm_tah
    FROM assets
    WHERE jsonb_typeof(campos_especificos->'anmTah') = 'array'
    ORDER BY id
  `);
  const rows = (result as any).rows as LegacyTahRow[];

  console.log(`[Backfill TAH] ${rows.length} ativo(s) com anmTah em formato legado (array).`);

  let atualizados = 0;
  let erros = 0;

  for (const row of rows) {
    const legado: any[] = Array.isArray(row.anm_tah) ? row.anm_tah : [];
    const { processo, registros, ambiguo, motivo } = computeTahBackfillPatch(row);
    const novo = {
      registros,
      ambiguo,
      backfilledEm: new Date().toISOString(),
    };
    const removidos = legado.length - registros.length;
    console.log(
      `  Ativo #${row.id} (${row.title ?? "sem título"}) processo=${processo ?? "?"}: ` +
      `${legado.length} registro(s) legados -> ${registros.length} mantidos` +
      (removidos > 0 ? ` (${removidos} de outros anos removidos)` : "") +
      (ambiguo ? ` [AMBÍGUO: ${motivo ?? "sem ano do processo"}]` : "")
    );
    if (dryRun) continue;
    try {
      await storage.mergeAssetCampos(row.id, { anmTah: novo });
      atualizados++;
    } catch (err: any) {
      erros++;
      console.error(`  ✗ Erro ao atualizar ativo #${row.id}:`, err.message);
    }
  }

  if (dryRun) {
    console.log(`[Backfill TAH] Dry-run: nada gravado.`);
  } else {
    console.log(`[Backfill TAH] Concluído: ${atualizados} atualizado(s), ${erros} erro(s).`);
    const check = await db.execute(sql`
      SELECT COUNT(*)::int AS restantes FROM assets
      WHERE jsonb_typeof(campos_especificos->'anmTah') = 'array'
    `);
    const restantes = (check as any).rows[0]?.restantes ?? "?";
    console.log(`[Backfill TAH] Ativos ainda com formato legado: ${restantes}`);
    if (Number(restantes) > 0) process.exitCode = 1;
  }

  await pool.end();
}

// Só executa quando rodado diretamente (permite importar os helpers em testes).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error("[Backfill TAH] Falha:", err);
    process.exit(1);
  });
}
