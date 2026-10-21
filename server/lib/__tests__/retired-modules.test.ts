import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { api } from "../../../shared/routes";
import ts from "typescript";

test("ativos e empresas têm contratos independentes dos módulos removidos", () => {
  assert.equal(api.assets.list.path, "/api/assets");
  assert.equal(api.assets.create.path, "/api/assets");
  assert.equal(api.companies.list.path, "/api/companies");
  assert.equal(api.companies.create.path, "/api/companies");
  assert.equal("crm" in api, false);
  assert.equal("matching" in api, false);
});

test("páginas e implementações dos módulos aposentados foram excluídas", () => {
  for (const path of [
    "client/src/pages/crm.tsx",
    "client/src/pages/crm/index.tsx",
    "client/src/pages/matching.tsx",
    "client/src/pages/showcase-publico.tsx",
    "client/src/pages/propostas.tsx",
    "client/src/pages/contratos.tsx",
    "server/routes/crm.ts",
    "server/routes/matching.ts",
    "server/routes/commercial.ts",
    "server/lib/auto-match.ts",
    "norion-standalone/client/src/pages/sdr.tsx",
  ]) assert.equal(existsSync(path), false, path);
});

test("ANM, fazendas, empresas e relatórios não consultam mais APIs aposentadas", () => {
  for (const path of [
    "client/src/pages/anm.tsx",
    "client/src/pages/geo-rural.tsx",
    "client/src/pages/empresas.tsx",
    "client/src/pages/ativo-detalhe.tsx",
    "client/src/pages/relatorios.tsx",
  ]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /\/api\/(?:crm|matching)\//, path);
  }
});

test("detalhe do ativo mantém os seletores das abas ativas", () => {
  const source = readFileSync("client/src/pages/ativo-detalhe.tsx", "utf8");
  const tabList = source.match(/<TabsList\b[^>]*>([\s\S]*?)<\/TabsList>/)?.[1];
  assert.ok(tabList, "A barra de abas não pode ficar vazia");
  assert.match(tabList, /ABAS_POR_TIPO\[ativo\.type\]/);
  assert.match(tabList, /<TabsTrigger\b[^>]*value=\{aba\.id\}/);
  assert.match(tabList, /\{aba\.label\}/);
  assert.doesNotMatch(tabList, /value=["']matches["']/);
});

test("cadastro de empresas continua sendo renderizado", () => {
  const source = readFileSync("client/src/pages/empresas.tsx", "utf8");
  assert.match(source, /company\.legalName/);
  assert.match(source, /\/api\/companies\/catalogo/);
});

test("Norion não registra página nem navegação de SDR", () => {
  assert.doesNotMatch(readFileSync("norion-standalone/client/src/App.tsx", "utf8"), /\/sdr|SdrPage/);
  assert.doesNotMatch(readFileSync("norion-standalone/client/src/components/norion-layout.tsx", "utf8"), /\/sdr/);
});

test("detalhe do ativo preserva gatilhos navegáveis das abas após a limpeza", () => {
  const source = readFileSync("client/src/pages/ativo-detalhe.tsx", "utf8");
  const tree = ts.createSourceFile("ativo-detalhe.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let navigableLists = 0;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "TabsList") {
      const text = node.getText(tree);
      assert.match(text, /ABAS_POR_TIPO\[ativo\.type\]/);
      assert.match(text, /<TabsTrigger\b[^>]*value=\{aba\.id\}/);
      assert.match(text, /\{aba\.label\}/);
      navigableLists++;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(navigableLists, 1);
  assert.match(source, /ABAS_POR_TIPO\["JAZIDA"\] = ABAS_POR_TIPO\["MINA"\]/);
  assert.match(source, /\{ id: "documentos", label: "Documentos" \}/);
  assert.match(source, /isTipoMinerario\(ativo\.type\) && \(\s*<TabsContent value="documentos"[^>]*>\s*<DocumentsPanel\s+tipo="ativo"\s+entityId=\{ativo\.id\}\s+ativoTipo=\{ativo\.type\}\s+ativoTitulo=\{ativo\.title\}/);
});

test("rotas de qualificação e criação de leads não são mais registradas", () => {
  const routes: string[] = [];
  for (const path of ["server/routes/ai.ts", "server/routes/companies.ts", "server/routes/export.ts"]) {
    const text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(source) === "app") {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteral(argument)) {
          routes.push(`${node.expression.name.text.toUpperCase()} ${argument.text}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(routes.includes("GET /api/companies/catalogo"));
  assert.ok(routes.includes("POST /api/cnpj/:cnpj/import"));
  assert.ok(routes.includes("POST /api/cnpj/:cnpj/disqualify"));
  for (const route of [
    "GET /api/companies/with-leads",
    "POST /api/companies/:id/lead",
    "POST /api/ai/score-lead/:id",
    "GET /api/export/leads",
  ]) assert.equal(routes.includes(route), false, route);
});

test("importação e enriquecimento de empresas não criam nem pontuam leads ou investidores", () => {
  const source = readFileSync("server/routes/companies.ts", "utf8");
  assert.doesNotMatch(source, /db\.(?:insert|update)\((?:leads|investorProfiles|companyBuyerProfiles)\)/);
  assert.match(source, /discardCompanyRecord\(db, orgId, cleanCnpj\)/);
  const analysis = readFileSync("server/lib/ai-agents.ts", "utf8");
  assert.doesNotMatch(analysis, /scoreLeadAI|companyBuyerProfiles|investorSummary|PERFIS DE COMPRADORES/);
});
