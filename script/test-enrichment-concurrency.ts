/**
 * Teste de regressão de concorrência — Task 155 (dados de enriquecimento que somem)
 *
 * Dispara vários salvamentos de enriquecimento em paralelo no mesmo ativo
 * (como as sub-abas Geologia/Restrições/DOU fazem) e verifica que TODAS as
 * chaves sobrevivem. Também simula o cenário antigo de clobbering: um PATCH
 * com cópia desatualizada do objeto inteiro não pode apagar chaves salvas
 * por outras consultas.
 *
 * Uso: npx tsx script/test-enrichment-concurrency.ts
 */
import { storage } from "../server/storage";
import { db, pool } from "../server/db";
import { scmProcessos } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { getProcessoFromCache } from "../server/lib/scm-scraper";

let falhas = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    falhas++;
    console.error(`  ✗ FALHOU: ${label}`);
  }
}

async function main() {
  console.log("\n[1] Criando ativo de teste...");
  const asset = await storage.createAsset({
    type: "MINA",
    title: "[TESTE-CONCORRENCIA] enrichment — pode apagar",
    camposEspecificos: { processoAnm: "800.123/2020", origemAtivo: "prospeccao_interna" },
  } as any);
  console.log(`  ativo id=${asset.id}`);

  try {
    // Cópia desatualizada capturada ANTES dos enriquecimentos (cliente antigo)
    const staleCopy = { ...(asset.camposEspecificos as any) };

    console.log("\n[2] 16 salvamentos de enriquecimento em PARALELO (updateAsset delta)...");
    const ts = new Date().toISOString();
    const keys = [
      "anmLiveData", "anmHistorico", "anmTitular", "anmCertidoesTitular",
      "anmGeologia", "anmRecursos", "anmSondagem", "anmGeoquimica",
      "anmBarragens", "anmRestricoes", "anmFunai", "anmFunaiTerras",
      "anmDou", "anmDouMunicipal", "anmCfem", "anmTah",
    ];
    await Promise.all(
      keys.map((k, i) =>
        storage.updateAsset(asset.id, {
          camposEspecificos: { [k]: { seq: i, fonte: k }, [`${k}UpdatedAt`]: ts },
        } as any),
      ),
    );

    console.log("\n[3] Em paralelo: edição básica + checklist + mergeAssetCampos (geo)...");
    await Promise.all([
      // edição de dados básicos com camposEspecificos gerenciados pelo formulário
      storage.updateAsset(asset.id, {
        title: "[TESTE-CONCORRENCIA] editado",
        priceAsking: 123456,
        camposEspecificos: { origemAtivo: "oferta_recebida", latitude: -12.34, longitude: -55.67 },
      } as any),
      // toggle de checklist (delta)
      storage.updateAsset(asset.id, {
        camposEspecificos: { checklistMina: { "Licença ambiental": true } },
      } as any),
      // fluxos de geo-enriquecimento do servidor
      storage.mergeAssetCampos(asset.id, { sigefParcelas: { total: 2, parcelas: [1, 2] } }),
      storage.mergeAssetCampos(asset.id, { anmLogistica: { rodovia: "BR-163" }, anmCotacao: { usd: 2650 } }),
    ]);

    const depois = await storage.getAsset(asset.id);
    const campos = (depois?.camposEspecificos as any) || {};

    console.log("\n[4] Verificando que TODAS as chaves sobreviveram...");
    for (const k of keys) {
      assert(campos[k]?.fonte === k, `chave ${k} presente`);
      assert(typeof campos[`${k}UpdatedAt`] === "string", `chave ${k}UpdatedAt presente`);
    }
    assert(campos.checklistMina?.["Licença ambiental"] === true, "checklist salvo");
    assert(campos.sigefParcelas?.total === 2, "sigefParcelas salvo (mergeAssetCampos)");
    assert(campos.anmLogistica?.rodovia === "BR-163", "anmLogistica salvo");
    assert(campos.anmCotacao?.usd === 2650, "anmCotacao salvo");
    assert(campos.origemAtivo === "oferta_recebida", "edição básica aplicada");
    assert(campos.latitude === -12.34, "latitude do formulário aplicada");
    assert(campos.processoAnm === "800.123/2020", "processoAnm original preservado");
    assert(depois?.title === "[TESTE-CONCORRENCIA] editado", "título editado");
    assert(depois?.priceAsking === 123456, "preço editado");

    console.log("\n[5] PATCH com cópia INTEIRA desatualizada (cliente antigo) não apaga nada...");
    await storage.updateAsset(asset.id, { camposEspecificos: staleCopy } as any);
    const aposStale = await storage.getAsset(asset.id);
    const camposStale = (aposStale?.camposEspecificos as any) || {};
    for (const k of keys) {
      assert(camposStale[k]?.fonte === k, `chave ${k} sobreviveu ao PATCH desatualizado`);
    }
    assert(camposStale.checklistMina?.["Licença ambiental"] === true, "checklist sobreviveu");
    assert(camposStale.origemAtivo === "prospeccao_interna", "chave presente na cópia foi atualizada (semântica de merge)");

    console.log("\n[6] Sobrescrita explícita com null continua possível...");
    await storage.updateAsset(asset.id, { camposEspecificos: { anmTah: null } } as any);
    const aposNull = await storage.getAsset(asset.id);
    assert((aposNull?.camposEspecificos as any)?.anmTah === null, "anmTah = null aplicado");
    assert((aposNull?.camposEspecificos as any)?.anmCfem?.fonte === "anmCfem", "demais chaves intactas");

    console.log("\n[7] mergeAssetCampos com extraFields municipio/location...");
    await storage.mergeAssetCampos(asset.id, { municipio: "Sorriso" }, { municipio: "Sorriso", location: "Sorriso/MT" });
    const aposExtra = await storage.getAsset(asset.id);
    assert(aposExtra?.municipio === "Sorriso", "coluna municipio atualizada");
    assert(aposExtra?.location === "Sorriso/MT", "coluna location atualizada");
    assert((aposExtra?.camposEspecificos as any)?.anmGeologia?.fonte === "anmGeologia", "enriquecimento intacto após extraFields");

    console.log("\n[8] Persistência SCM: registro em scm_processos é relido após 'reload'...");
    const procTeste = { numero: 999999, ano: 1901 }; // processo claramente fictício
    await db.delete(scmProcessos).where(and(eq(scmProcessos.numero, procTeste.numero), eq(scmProcessos.ano, procTeste.ano)));
    await db.insert(scmProcessos).values({
      processo: `${procTeste.numero}/${procTeste.ano}`,
      numero: procTeste.numero,
      ano: procTeste.ano,
      titularNome: "EMPRESA TESTE SCM LTDA",
      titularCnpj: "11222333000181",
      tipoPessoa: "PJ",
      fase: "CONCESSÃO DE LAVRA",
      uf: "MT",
      consultadoEm: new Date(),
    } as any);
    const relido = await getProcessoFromCache("999999/1901");
    assert(relido?.titularCnpj === "11222333000181", "getProcessoFromCache devolve o titular salvo (base da sub-aba SCM pós-reload)");
    assert(relido?.titularNome === "EMPRESA TESTE SCM LTDA", "nome do titular relido");
    await db.delete(scmProcessos).where(and(eq(scmProcessos.numero, procTeste.numero), eq(scmProcessos.ano, procTeste.ano)));
  } finally {
    console.log("\n[9] Limpando ativo de teste...");
    await storage.deleteAsset(asset.id);
  }

  if (falhas > 0) {
    console.error(`\n❌ ${falhas} verificação(ões) falharam`);
  } else {
    console.log("\n✅ Todas as verificações passaram — enriquecimentos concorrentes não se apagam.");
  }
  await pool.end();
  // saída explícita: módulos importados (scm-scraper) mantêm timers vivos
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("Erro no teste:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
