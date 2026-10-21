// Build reproduzível da Mavrion Hub API (VPS api.mavrionconnect.com.br)
// Fonte: src/index.cjs (bundle de produção de 21/03 recuperado e des-minificado,
// já contendo o guard de /api/sicar/:codigo e os kill-switches por env).
//
// O fonte JÁ contém as dependências da allowlist inlined (esbuild bundle do
// build original) — por isso aqui NÃO se faz bundle, apenas minify.
// Os require() de dependências externas permanecem intactos e são resolvidos
// pelo node_modules do VPS em runtime.
//
// Uso: node build.mjs   → gera dist/index.cjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

await build({
  entryPoints: ["src/index.cjs"],
  platform: "node",
  bundle: false, // NUNCA bundle: deps externas resolvem no VPS
  minify: true,
  format: "cjs",
  outfile: "dist/index.cjs",
  logLevel: "info",
});

// Verificações pós-build: sintaxe + conjunto de rotas idêntico ao fonte
execFileSync("node", ["--check", "dist/index.cjs"], { stdio: "inherit" });
const routes = (f) =>
  [...new Set(readFileSync(f, "utf8").match(/"\/api\/[^"]+"/g) ?? [])]
    .sort()
    .join("\n");
if (routes("src/index.cjs") !== routes("dist/index.cjs")) {
  console.error("ERRO: conjunto de rotas do build difere do fonte!");
  process.exit(1);
}
console.log("OK: sintaxe válida e rotas idênticas ao fonte.");
