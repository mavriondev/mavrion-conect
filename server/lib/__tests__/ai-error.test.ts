// Testes unitários de mapAiError — rodar com: npx tsx server/lib/__tests__/ai-error.test.ts
import assert from "node:assert";
import { mapAiError } from "../ai-error";

// 1. Quota esgotada via código estruturado (429 + insufficient_quota)
let r = mapAiError({ status: 429, code: "insufficient_quota", message: "429 You exceeded your current quota" }, "fallback");
assert.equal(r.status, 503);
assert.ok(r.message.includes("sem créditos"), "quota (code) deve virar msg de sem créditos");

// 2. Quota esgotada via texto "no credits remaining"
r = mapAiError({ status: 429, message: "429 You have no credits remaining. Add credits to continue." }, "fallback");
assert.equal(r.status, 503);
assert.ok(r.message.includes("sem créditos"), "quota (texto) deve virar msg de sem créditos");

// 3. 429 genérico = rate limit temporário, NÃO falta de créditos
r = mapAiError({ status: 429, code: "rate_limit_exceeded", message: "429 Rate limit reached for gpt-4o" }, "fallback");
assert.equal(r.status, 503);
assert.ok(!r.message.includes("sem créditos"), "rate limit não pode ser diagnosticado como sem créditos");
assert.ok(r.message.includes("Tente novamente"), "rate limit deve sugerir tentar novamente");

// 4. Chave ausente (SDK lança sem status HTTP)
r = mapAiError(new Error("Missing credentials. Please pass an `apiKey`, or set the `OPENAI_API_KEY` environment variable."), "fallback");
assert.equal(r.status, 503);
assert.ok(r.message.includes("não configurada"), "chave ausente deve virar msg de chave não configurada");

// 5. Chave inválida (401)
r = mapAiError({ status: 401, code: "invalid_api_key", message: "401 Incorrect API key provided: sk-xxx" }, "fallback");
assert.equal(r.status, 503);
assert.ok(r.message.includes("inválida"), "401 deve virar msg de chave inválida");

// 6. Erro genérico mantém 500 e mensagem original
r = mapAiError(new Error("Ativo não encontrado"), "fallback");
assert.equal(r.status, 500);
assert.equal(r.message, "Ativo não encontrado");

// 7. Erro sem mensagem usa fallback
r = mapAiError({}, "Erro ao analisar ativo");
assert.equal(r.status, 500);
assert.equal(r.message, "Erro ao analisar ativo");

console.log("✅ mapAiError: todos os 7 testes passaram");
