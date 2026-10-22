// Diagnóstico pontual, somente leitura, sem cache e sem persistir verificações.
// Uso: npx tsx scripts/validar-restricoes-wfs.ts <id-da-fazenda>
// Pode ser empacotado com esbuild e executado via stdin no servidor de produção,
// sem substituir o aplicativo publicado nem iniciar rotinas em massa.
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { carregarAtivoGeo, verificarSobreposicoes } from "../server/lib/verificacoes-terra";

async function main() {
  if (process.argv.length !== 3 || !/^[1-9]\d*$/.test(process.argv[2])) {
    throw new Error("Informe exatamente um ID de fazenda.");
  }
  const id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id)) throw new Error("ID inválido.");
  const rows = await db.execute(sql`SELECT org_id FROM assets WHERE id = ${id} AND type = 'TERRA' LIMIT 1`);
  const orgId = rows.rows[0]?.org_id;
  if (!orgId) throw new Error("Fazenda não encontrada.");
  const ativo = await carregarAtivoGeo(id, Number(orgId));
  if (!ativo) throw new Error("Fazenda sem polígono.");
  const verificacoes = await verificarSobreposicoes(ativo, { usarCache: false });
  const alvo = verificacoes.filter(v => ["sobreposicao_ti", "sobreposicao_quilombola", "sobreposicao_uc"].includes(v.chave));
  console.log(JSON.stringify({ assetId: id, somenteLeitura: true, verificacoes: alvo }, null, 2));
  if (alvo.length !== 3 || alvo.some(v => v.estado === "sem_dado")) {
    throw new Error("Uma ou mais fontes continuam indisponíveis; não interpretar como ausência.");
  }
}

main().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
}).finally(() => pool.end());
