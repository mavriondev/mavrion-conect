// Testes do parser SEI — rodar com: npx tsx server/lib/__tests__/sei-scraper.test.ts
// Fixtures capturadas da pesquisa pública real do SEI/ANM (2026-08), processo
// NUP 48054.832070/2024-14. Cobre a lição do SCM: página sem dados reais ou
// que não menciona o NUP consultado NÃO pode virar consulta válida.
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeNup,
  parseSeiResultRows,
  parseSeiProcessoHtml,
  hasRealSeiData,
  isSeiCaptchaRejeitado,
  seiSolrSearchDigits,
  decidirResultadoSei,
  type SeiResultadoRow,
} from "../sei-scraper";
import { validateNupDv, parseNupEstruturado } from "@shared/nup";

const fixturesDir = join(import.meta.dirname, "fixtures");
const detalheHtml = readFileSync(join(fixturesDir, "sei-processo-detalhe.html"), "utf8");
const resultadoHtml = readFileSync(join(fixturesDir, "sei-resultado-pesquisa.html"), "utf8");

// 1. normalizeNup: formatos aceitos e chave em dígitos
let n = normalizeNup("48054.832070/2024-14");
assert.ok(n, "NUP formatado deve ser aceito");
assert.equal(n!.digits, "48054832070202414");
assert.equal(n!.formatado, "48054.832070/2024-14");

n = normalizeNup("48054832070202414");
assert.ok(n, "NUP só com dígitos deve ser aceito");
assert.equal(n!.formatado, "48054.832070/2024-14", "17 dígitos devem ganhar a máscara padrão");

assert.equal(normalizeNup("832070/2024"), null, "número de processo SCM (10 dígitos) não é NUP");
assert.equal(normalizeNup(""), null);
assert.equal(normalizeNup("abc"), null);

// 2. Linhas do resultado da pesquisa (fragmento devolvido pelo AJAX)
const rows = parseSeiResultRows(resultadoHtml);
assert.equal(rows.length, 1, "deve achar 1 processo no resultado");
assert.equal(rows[0].prot, "48054.832070/2024-14", "data-prot deve ser o NUP");
assert.ok(rows[0].link.startsWith("md_pesq_processo_exibir.php?"), "link de detalhe presente");
assert.ok(!rows[0].link.includes("&amp;"), "entidades HTML do link devem ser decodificadas");
assert.equal(rows[0].unidade, "PROTOCOLO DIGITAL");
assert.equal(rows[0].data, "31/10/2024");

// 3. Página de detalhe: cabeçalho (autuação)
const p = parseSeiProcessoHtml(detalheHtml);
assert.equal(p.processo, "48054.832070/2024-14", "processo do cabeçalho");
assert.equal(p.tipo, "Gestão de Títulos: Autorização de Pesquisa");
assert.equal(p.dataGeracao, "31/10/2024");
assert.equal(p.interessados.length, 1);
assert.ok(p.interessados[0].startsWith("MORETE MINERADORA"), "interessado sem vírgula final");
assert.ok(!p.interessados[0].endsWith(","), "vírgula final removida");

// 4. Lista de Protocolos (documentos)
assert.equal(p.documentos.length, 12, "12 documentos na Lista de Protocolos");
const doc0 = p.documentos[0];
assert.equal(doc0.numero, "14810683");
assert.equal(doc0.tipo, "Requerimento");
assert.equal(doc0.data, "31/10/2024");
assert.equal(doc0.dataInclusao, "31/10/2024");
assert.equal(doc0.unidade, "PROTOCOLO DIGITAL");
assert.ok(
  doc0.linkPublico?.startsWith("https://sei.anm.gov.br/sei/modulos/pesquisa/md_pesq_documento_consulta_externa.php?"),
  "link público de consulta externa montado"
);
// todos os documentos têm número não vazio
for (const d of p.documentos) assert.ok(d.numero, "documento com número");

// 5. Lista de Andamentos
assert.equal(p.andamentos.length, 15, "15 andamentos no histórico");
const a0 = p.andamentos[0];
assert.equal(a0.dataHoraTexto, "21/01/2025 16:34");
assert.equal(a0.dataHora, "2025-01-21T16:34:00", "data/hora convertida para ISO local");
assert.equal(a0.unidade, "DIFIP-MG");
assert.ok(a0.unidadeNome?.includes("Fiscalização da Pesquisa"), "nome completo da unidade via title");
assert.ok(a0.descricao.includes("Conclusão do processo na unidade"));
// andamento com link embutido na descrição vira texto plano
const remetido = p.andamentos.find(a => a.descricao.includes("remetido"));
assert.ok(remetido, "andamento de remessa presente");
assert.ok(remetido!.descricao.includes("ENTRADA-MG"), "descrição preserva texto do link");
assert.ok(!/[<>]/.test(remetido!.descricao), "descrição sem tags HTML");

// 6. Validação de dados reais (lição do SCM)
assert.equal(hasRealSeiData(p), true, "página real tem documentos e andamentos");
const vazio = parseSeiProcessoHtml("<html><body><p>nada aqui</p></body></html>");
assert.equal(hasRealSeiData(vazio), false, "página sem tabelas não pode ser salva");
assert.equal(vazio.processo, null);

// Página com cabeçalho mas sem documentos/andamentos também é rejeitada
const soCabecalho = parseSeiProcessoHtml(`
  <table id="tblCabecalho">
    <tr><td><b>Processo:</b></td><td>48054.832070/2024-14</td></tr>
    <tr><td><b>Tipo:</b></td><td>Gestão de Títulos</td></tr>
  </table>`);
assert.equal(soCabecalho.processo, "48054.832070/2024-14");
assert.equal(hasRealSeiData(soCabecalho), false, "só cabeçalho não é dado real");

// 7. Detecção de captcha rejeitado (resposta real do SEI)
const captchaRejeitadoHtml =
  '<consultavazia><div class="sem-resultado"><p class="alert alert-danger">Código de confirmação inválido 1.</p></div></consultavazia>';
assert.equal(isSeiCaptchaRejeitado(captchaRejeitadoHtml), true, "detecta captcha inválido");
assert.equal(isSeiCaptchaRejeitado(resultadoHtml), false, "resultado válido não é rejeição");
assert.equal(isSeiCaptchaRejeitado(""), false);

// 8. Resultado vazio (NUP inexistente): consultavazia sem linhas → 0 rows
const consultaVazia = '<consultavazia><div class="sem-resultado"><p>Nenhum registro encontrado.</p></div></consultavazia>';
assert.equal(parseSeiResultRows(consultaVazia).length, 0, "consulta vazia não gera linhas");
assert.equal(isSeiCaptchaRejeitado(consultaVazia), false, "consulta vazia não é captcha rejeitado");

// 9. Validador de DV do NUP (algoritmo federal: pesos 16→2 sobre a base,
// 17→2 sobre base+DV1; 11−(soma mod 11), com 10→0 e 11→1). Calibrado com
// dois NUPs reais da ANM.
let dv = validateNupDv("48054.832070/2024-14");
assert.ok(dv && dv.valido, "NUP real 48054.832070/2024-14 tem DV válido");
assert.equal(dv!.dvEsperado, "14");

dv = validateNupDv("48405.850722/2012-23");
assert.ok(dv && dv.valido, "NUP 48405.850722/2012-23 (caso do falso 'confira o NUP') tem DV válido");
assert.equal(dv!.dvEsperado, "23");

dv = validateNupDv("48054.832070/2024-13");
assert.ok(dv && !dv.valido, "DV errado é detectado");
assert.equal(dv!.dvEsperado, "14", "aviso informa o DV esperado");

assert.equal(validateNupDv("48405.850722/2012"), null, "15 dígitos: sem DV para validar");
assert.equal(validateNupDv(""), null);
assert.equal(validateNupDv("abc"), null);

// 10. Parse estruturado do NUP (comparação por campos, nunca substring)
const est17 = parseNupEstruturado("48405.850722/2012-23");
assert.ok(est17, "NUP formatado de 17 dígitos é estruturável");
assert.equal(est17!.prefixo, "48405");
assert.equal(est17!.sequencial, "850722");
assert.equal(est17!.ano, "2012");
assert.equal(est17!.dv, "23");

const est15 = parseNupEstruturado("484058507222012");
assert.ok(est15, "NUP de 15 dígitos (sem DV) é estruturável");
assert.equal(est15!.dv, null);
assert.equal(est15!.sequencial, "850722");
assert.equal(est15!.ano, "2012");

assert.equal(parseNupEstruturado("832070/2024"), null, "10 dígitos não têm estrutura de NUP");
assert.equal(parseNupEstruturado("4840585072220122"), null, "16 dígitos não têm estrutura conhecida");

// 11. Dígitos do filtro Solr: sequencial+ano (acha o processo mesmo sob outro
// prefixo de unidade/DV — caso dos processos antigos digitalizados)
assert.equal(seiSolrSearchDigits("48405850722201223"), "8507222012");
assert.equal(seiSolrSearchDigits("484058507222012"), "8507222012", "15 dígitos também usam sequencial+ano");
assert.equal(seiSolrSearchDigits("4840585072220122"), "4840585072220122", "sem estrutura conhecida: dígitos completos");

// 12. Decisão do resultado da pesquisa (matching estruturado das linhas)
const mkRow = (prot: string): SeiResultadoRow => ({
  prot,
  link: "md_pesq_processo_exibir.php?token",
  titulo: prot,
  unidade: null,
  data: null,
});

// 12a. Fixture real: match exato de 17 dígitos
let dec = decidirResultadoSei(1, rows, "48054832070202414");
assert.equal(dec.tipo, "match");
assert.equal((dec as any).match.tipo, "exato");
assert.equal((dec as any).match.nupConfirmadoDigits, "48054832070202414");
assert.equal((dec as any).match.nupConfirmadoFormatado, "48054.832070/2024-14");

// 12b. Prefixo/DV divergentes, mesmo sequencial+ano → candidato ÚNICO aceito
dec = decidirResultadoSei(1, rows, "48000832070202499");
assert.equal(dec.tipo, "match", "prefixo/DV diferentes não impedem o match estruturado");
assert.equal((dec as any).match.tipo, "compativel");
assert.equal((dec as any).match.nupConfirmadoDigits, "48054832070202414", "o NUP confirmado é o da linha do SEI");

// 12c. Match exato tem precedência sobre candidatos compatíveis
dec = decidirResultadoSei(2, [mkRow("48013.850722/2012-70"), mkRow("48405.850722/2012-23")], "48405850722201223");
assert.equal(dec.tipo, "match");
assert.equal((dec as any).match.tipo, "exato");
assert.equal((dec as any).match.nupConfirmadoDigits, "48405850722201223");

// 12d. Múltiplos candidatos distintos sem exato → ambíguo (falhar, não adivinhar)
dec = decidirResultadoSei(2, [mkRow("48013.850722/2012-70"), mkRow("48420.850722/2012-11")], "48405850722201223");
assert.equal(dec.tipo, "ambiguo");
assert.deepEqual((dec as any).candidatos, ["48013.850722/2012-70", "48420.850722/2012-11"]);

// ...mas linhas duplicadas do MESMO NUP contam como um candidato só
dec = decidirResultadoSei(2, [mkRow("48013.850722/2012-70"), mkRow("48013.850722/2012-70")], "48405850722201223");
assert.equal(dec.tipo, "match", "duplicata do mesmo NUP não é ambiguidade");

// 12e. Linha com NUP de 15 dígitos (sem DV) casa por sequencial+ano
dec = decidirResultadoSei(1, [mkRow("48405.850722/2012")], "48405850722201223");
assert.equal(dec.tipo, "match");
assert.equal((dec as any).match.tipo, "compativel");
assert.equal((dec as any).match.nupConfirmadoFormatado, "48405.850722/2012");

// 12f. Dígitos atravessando fronteiras de campos NÃO casam: o NUP
// 48507.222012/2024-01 contém a substring "8507222012", mas o sequencial/ano
// dele é 222012/2024 — comparação estruturada rejeita.
dec = decidirResultadoSei(1, [mkRow("48507.222012/2024-01")], "48405850722201223");
assert.equal(dec.tipo, "sem_linha_compativel", "substring cruzando campos não é match");

// 12g. Zero itens e zero linhas = resposta legítima do SEI (processo não
// digitalizado ou com acesso restrito) — desfecho próprio, sem culpar o NUP
dec = decidirResultadoSei(0, [], "48405850722201223");
assert.equal(dec.tipo, "sem_resultados");

// 12h. Ramo anômalo: SEI diz ter itens mas nenhuma linha parseou / nenhuma bate
dec = decidirResultadoSei(3, [], "48405850722201223");
assert.equal(dec.tipo, "sem_linha_compativel", "itens>0 sem linhas parseadas = possível mudança de estrutura");
dec = decidirResultadoSei(1, rows, "48405850722201223");
assert.equal(dec.tipo, "sem_linha_compativel", "itens>0 só com linhas de outros processos");

console.log("✅ sei-scraper.test.ts: todos os testes passaram");
process.exit(0);
