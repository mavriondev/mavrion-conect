/**
 * Run after npm run build: npx tsx script/verify-client-loading.ts
 * Check the actual static dependency graph, not just the entry chunk size.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve("dist/public");
const html = readFileSync(path.join(root, "index.html"), "utf8");
const entry = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
assert.ok(entry, "Build the client before checking its loading graph");

const initial = new Set<string>();
function visit(file: string) {
  if (initial.has(file)) return;
  initial.add(file);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      assert.ok(specifier.startsWith("."), `Unexpected external import: ${specifier}`);
      visit(path.resolve(path.dirname(file), specifier));
    }
  }
}
visit(path.join(root, entry));
// modulepreload links are fetched eagerly too.
for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) {
  visit(path.join(root, match[1]));
}

const deferred = [
  "dashboard", "ativos", "ativo-detalhe", "relatorios", "geo-rural",
  "prospeccao", "empresa-detail", "maplibre-gl", "jspdf", "html2canvas",
];
const assets = readdirSync(path.join(root, "assets"));
for (const name of deferred) {
  const chunks = assets.filter(file => file.startsWith(`${name}-`) && file.endsWith(".js"))
    .concat(name === "jspdf" || name === "html2canvas"
      ? assets.filter(file => file.startsWith(`${name}.`) && file.endsWith(".js")) : []);
  assert.ok(chunks.length, `Missing deferred chunk: ${name}`);
  for (const chunk of chunks) {
    assert.ok(!initial.has(path.join(root, "assets", chunk)), `${name} is loaded on entry`);
  }
}

const bytes = [...initial].reduce((sum, file) => sum + statSync(file).size, 0);
assert.ok(bytes < 750_000, `Initial JS exceeded 750 kB: ${bytes} bytes`);
console.log(`Initial JS: ${(bytes / 1000).toFixed(2)} kB in ${initial.size} file(s). Pages, maps and PDF libraries remain deferred.`);
