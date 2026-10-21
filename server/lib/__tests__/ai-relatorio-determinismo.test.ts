// Testes das seções de IA do relatório (determinismo, contatos, cache)
// Rodar com: npx tsx server/lib/__tests__/ai-relatorio-determinismo.test.ts
import assert from "node:assert";
import {
  hashInsumos,
  secaoDataAtual,
  validarTelefoneBR,
  validarContatosDeepIntel,
  AVISO_CONTATO_DESATUALIZADO,
} from "../ai-relatorio-determinismo";

// ── 1. Determinismo: mesmo input ⇒ mesmo hash (chave do cache) ──
const digest = "ATIVO: Fazenda X | tipo=MINA | processo=832070/2024";
assert.equal(hashInsumos(digest), hashInsumos(digest), "mesmo input deve gerar o mesmo hash");
assert.notEqual(hashInsumos(digest), hashInsumos(digest + " fase=LAVRA"), "input diferente deve gerar hash diferente");
assert.match(hashInsumos(digest), /^[0-9a-f]{64}$/, "hash sha256 hex");

// ── 2. Data atual no prompt com vigência minerária canônica ──
const secData = secaoDataAtual(new Date("2026-08-14T12:00:00-03:00"));
assert.ok(secData.includes("14/08/2026"), "deve conter a data atual");
assert.ok(/VIGÊNCIA CANÔNICA/.test(secData), "deve apontar a fonte única de vigência");
assert.ok(/NUNCA faça aritmética/.test(secData), "modelo não pode recalcular vigência do alvará");
assert.ok(/eventos brutos de vigência não são fornecidos/i.test(secData), "eventos não são uma segunda fonte de cálculo");

// ── 3. Validação de telefones BR ──
// celular válido com DDD da UF da sede
let v = validarTelefoneBR("(34) 99975-1234", "MG");
assert.ok(v.valido && !v.mismatchUf, "celular MG com sede MG deve validar");
assert.equal(v.e164, "+5534999751234", "deve normalizar para E.164");
// DDD × UF mismatch
v = validarTelefoneBR("(11) 99975-1234", "MG");
assert.ok(v.valido && v.mismatchUf, "DDD 11 (SP) com sede MG deve ser mismatch");
assert.ok(v.motivo?.includes("SP"), "motivo deve citar a UF do DDD");
// celular com 8 dígitos que não começa com 9 (formato antigo inválido p/ 9 dígitos)
v = validarTelefoneBR("34 89975-1234", "MG");
assert.ok(!v.valido, "9 dígitos não iniciando em 9 é inválido");
// fixo de 8 dígitos é aceito
v = validarTelefoneBR("(34) 3223-1234", "MG");
assert.ok(v.valido && !v.mismatchUf, "fixo 8 dígitos deve validar");
// DDD inexistente
v = validarTelefoneBR("(20) 99975-1234", "MG");
assert.ok(!v.valido && /inexistente/.test(v.motivo || ""), "DDD 20 não existe");
// com código do país
v = validarTelefoneBR("+55 34 99975-1234", "MG");
assert.ok(v.valido && v.ddd === "34", "deve aceitar +55");
// lixo
v = validarTelefoneBR("abc", "MG");
assert.ok(!v.valido, "string sem dígitos suficientes é inválida");

// ── 4. Contatos deep intel: mismatch rebaixa confiança + aviso ──
const contatos = validarContatosDeepIntel([
  { tipo: "telefone", valor: "(11) 98888-7777", confianca: "alta" },
  { tipo: "telefone", valor: "(34) 98888-7777", confianca: "alta" },
  { tipo: "email", valor: "x@y.com", confianca: "alta" },
], "MG");
assert.equal(contatos[0].confianca, "media", "mismatch DDD×UF deve rebaixar alta→media");
assert.ok(contatos[0].aviso?.includes(AVISO_CONTATO_DESATUALIZADO), "deve anexar o aviso padrão");
assert.equal(contatos[1].confianca, "alta", "telefone válido mantém confiança");
assert.equal(contatos[1].aviso, undefined, "telefone válido não recebe aviso");
assert.equal(contatos[2].aviso, undefined, "email não passa por validação de telefone");
// rebaixamento baixa continua baixa (nunca sobe)
const c2 = validarContatosDeepIntel([{ tipo: "whatsapp", valor: "(11) 98888-7777", confianca: "baixa" }], "MG");
assert.equal(c2[0].confianca, "baixa");
assert.ok(c2[0].aviso, "whatsapp inválido também recebe aviso");

// ── 5. (Removido) Score de confiança da investigação ──
// O score de confiança determinístico foi removido do produto: nenhum score
// de confiança sobre conclusões aparece em nenhuma saída — o único indicador
// é o score de completude do dossiê (ver lacunas-dossie.test.ts).

// ── 6. Cache do parecer consolidado: hash determinístico do insumo canônico ──
// (A Due Diligence de IA foi removida do produto a pedido do usuário; o
// insumo canônico é o digest completo do ativo.)
const { buildConsolidatedInsumos, hashConsolidatedInsumos } = await import("../asset-report");
const mkAsset = (title: string) => ({ id: 1, title, type: "FAZENDA", description: "campo livre fora dos insumos", camposEspecificos: {} });
const h1 = hashConsolidatedInsumos(mkAsset("Fazenda X"));
const h1b = hashConsolidatedInsumos(mkAsset("Fazenda X"));
const h2 = hashConsolidatedInsumos(mkAsset("Fazenda Y"));
assert.equal(h1, h1b, "mesmo ativo ⇒ mesmo hash de insumos consolidados");
assert.notEqual(h1, h2, "mudança em qualquer dado do ativo deve invalidar o cache");
assert.equal(buildConsolidatedInsumos(mkAsset("Fazenda X")), buildConsolidatedInsumos(mkAsset("Fazenda X")), "insumo canônico é determinístico");

// ── 7. Cache do deep intel: seções derivadas de IA não invalidam o cache ──
// A rota persiste iaEnrichment (com timestamp novo) após cada análise; o
// hash canônico ignora essas seções — senão o cache se auto-invalidaria.
const { insumosCanonicosDeepIntel } = await import("../ai-relatorio-determinismo");
const dadosReais = ["ATIVO: Fazenda X | MG", "DADOS ANM: processo 832070/2024"];
const rodada1 = [...dadosReais, "ENRIQUECIMENTO IA ANTERIOR:\n- Score Atratividade: 70/100\n- Resumo: v1"];
const rodada2 = [...dadosReais, "ANÁLISE IA ANTERIOR (resumo):\nnovo texto", "ENRIQUECIMENTO IA ANTERIOR:\n- Score Atratividade: 82/100\n- Resumo: v2 (enrichedAt mudou)"];
const hashR1 = hashInsumos(insumosCanonicosDeepIntel(rodada1));
const hashR2 = hashInsumos(insumosCanonicosDeepIntel(rodada2));
assert.equal(hashR1, hashR2, "regravar iaEnrichment/iaAnalise após a análise NÃO pode invalidar o cache (segunda execução = cache hit)");
// mas mudança em dado REAL invalida
const hashR3 = hashInsumos(insumosCanonicosDeepIntel([...dadosReais, "DADOS ANM: novo evento"]));
assert.notEqual(hashR1, hashR3, "mudança em dado real deve invalidar o cache");
assert.ok(insumosCanonicosDeepIntel(rodada2).includes("DADOS ANM"), "seções reais preservadas no insumo canônico");
assert.ok(!insumosCanonicosDeepIntel(rodada2).includes("ENRIQUECIMENTO IA"), "seções derivadas fora do insumo canônico");

console.log("✅ ai-relatorio-determinismo: todos os testes passaram");
