import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import {
  companies, mavrionCafRegistros, mavrionOperations, mavrionDocuments,
  mavrionFundosParceiros, mavrionEnviosFundos, mavrionClientUsers, mavrionFormularioCliente,
} from "../../../shared/schema";

test("nomes Mavrion preservam as tabelas e colunas existentes sem migração destrutiva", () => {
  for (const [table, physical] of [
    [mavrionOperations, "norion_operations"], [mavrionDocuments, "norion_documents"],
    [mavrionFundosParceiros, "norion_fundos_parceiros"], [mavrionEnviosFundos, "norion_envios_fundos"],
    [mavrionCafRegistros, "norion_caf_registros"], [mavrionClientUsers, "norion_client_users"],
    [mavrionFormularioCliente, "norion_formulario_cliente"],
  ] as const) assert.equal(getTableName(table), physical);
  assert.equal(companies.mavrionProfile.name, "norion_profile");
  assert.equal(mavrionCafRegistros.mavrionProfile.name, "norion_profile");
});

test("SICOR pertence ao Mavrion e continua consultando o Banco Central", () => {
  const geo = readFileSync("server/routes/geo.ts", "utf8");
  assert.ok(geo.includes('app.get("/api/mavrion/sicor/:codigoMunicipio"'));
  assert.ok(geo.includes("https://olinda.bcb.gov.br/olinda/servico/SICOR"));
  for (const path of ["client/src/pages/ativo-detalhe.tsx", "client/src/pages/empresa/detail.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("/api/mavrion/sicor/"));
    assert.doesNotMatch(source, /\/api\/norion\//);
  }
});

test("CAF, IA e exclusão de empresas usam os símbolos Mavrion", () => {
  for (const path of [
    "server/routes/caf-extrator.ts", "server/services/caf-crawler.ts",
    "server/routes/assets.ts", "server/routes/companies.ts", "server/lib/ai-agents.ts",
  ]) assert.doesNotMatch(readFileSync(path, "utf8"), /norion|Norion/);
  const caf = readFileSync("server/routes/caf-extrator.ts", "utf8");
  assert.ok(caf.includes("req.query.mavrionProfile"));
  const ai = readFileSync("server/lib/ai-agents.ts", "utf8");
  assert.equal((ai.match(/getTableName\(mavrionCafRegistros\)/g) || []).length, 3);
});

test("Mavrion não mantém telas nem rotas de consulta de fundos", () => {
  const source = readFileSync("client/src/pages/ativo-detalhe.tsx", "utf8");
  assert.doesNotMatch(source, /cvmData|consultarCvm|parseCvmFundLookup|value="cvm"/);
  assert.doesNotMatch(readFileSync("server/routes.ts", "utf8"), /registerCvmRoutes|routes\/cvm/);
  for (const path of [
    "server/routes/cvm.ts", "client/src/lib/cvm-funds.ts", "client/src/pages/fii-fundos.tsx",
  ]) assert.equal(existsSync(path), false, path);
});

test("cadastro, prospecção e análise não oferecem funcionalidades de fundos", () => {
  assert.doesNotMatch(readFileSync("client/src/pages/ativos.tsx", "utf8"), /FII_CRI|registroCvm|tipoFundo/);
  assert.doesNotMatch(readFileSync("server/routes/prospeccao.ts", "utf8"), /FII_CRI|fundo imobiliário/);
  assert.doesNotMatch(readFileSync("server/lib/ai-agents.ts", "utf8"), /cvmData|tipoFundo|FII_CRI|fundos de investimento/);
  const routes = readFileSync("server/routes/assets.ts", "utf8");
  assert.ok(routes.includes('input.type === "FII_CRI"'));
  assert.ok(routes.includes('req.body.type === "FII_CRI" && asset.type !== "FII_CRI"'));
});
