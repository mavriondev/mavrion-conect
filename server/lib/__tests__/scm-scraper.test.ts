// Testes do parser SCM — rodar com: npx tsx server/lib/__tests__/scm-scraper.test.ts
// Cobre o bug do painel "Dados básicos" vazio: uma página onde só a
// "Área (ha)" vem preenchida NÃO pode ser considerada consulta válida.
import assert from "node:assert";
import { parseScmHtml, hasStrongScmField, parseEventosScmHtml } from "../scm-scraper";

// Esqueleto real (simplificado) do painel "Dados básicos" do SCM quando o
// POST assíncrono volta vazio: todos os spans de dados vazios, exceto a área.
const esqueletoVazio = `
<html><body>
<div id="ctl00_conteudo_upProcesso">
  <table>
    <tr><td>Processo</td><td><span id="ctl00_conteudo_lblProcesso"></span></td></tr>
    <tr><td>NUP</td><td><span id="ctl00_conteudo_lblNup"></span></td></tr>
    <tr><td>Tipo/Fase</td><td><span id="ctl00_conteudo_lblTipoFase"></span></td></tr>
    <tr><td>Área (ha)</td><td><span id="ctl00_conteudo_lblArea">1.955,42</span></td></tr>
    <tr><td>UF</td><td><span id="ctl00_conteudo_lblUf"></span></td></tr>
    <tr><td>Data Protocolo</td><td><span id="ctl00_conteudo_lblDataProtocolo"></span></td></tr>
  </table>
  <table>
    <tr><td>Nome</td><td>CPF/CNPJ</td></tr>
  </table>
</div>
</body></html>`;

// Página com dados reais do processo.
const paginaComDados = `
<html><body>
<div id="ctl00_conteudo_upProcesso">
  <table>
    <tr><td>NUP</td><td><span id="ctl00_conteudo_lblNup">48054.831522/1984-01</span></td></tr>
    <tr><td>Tipo/Fase</td><td><span id="ctl00_conteudo_lblTipoFase">Requerimento de Lavra / Concessão de Lavra</span></td></tr>
    <tr><td>Área (ha)</td><td><span id="ctl00_conteudo_lblArea">1.955,42</span></td></tr>
  </table>
</div>
</body></html>`;

// 1. Esqueleto vazio: parser não deve inventar campos fortes
let p = parseScmHtml(esqueletoVazio);
assert.equal(p.nup, null, "nup deve ser null no esqueleto vazio");
assert.equal(p.fase, null, "fase deve ser null no esqueleto vazio");
assert.equal(p.titularNome, null, "titularNome deve ser null no esqueleto vazio");
assert.equal(p.titularCnpj, null, "titularCnpj deve ser null no esqueleto vazio");
assert.equal(p.titularCpf, null, "titularCpf deve ser null no esqueleto vazio");
assert.equal(p.areaHa, 1955.42, "área deve ser parseada mesmo no esqueleto vazio");

// 2. Só área preenchida NÃO é campo forte → consulta deve ser rejeitada
assert.equal(hasStrongScmField(p), false, "página só com área não pode ser salva como consulta");

// 3. Página com nup/fase reais → aceita
p = parseScmHtml(paginaComDados);
assert.ok(p.nup, "nup deve ser extraído da página com dados");
assert.ok(p.fase, "fase deve ser extraída da página com dados");
assert.equal(hasStrongScmField(p), true, "página com nup/fase deve ser aceita");

// 4. Campos fortes individuais bastam
const base = { nup: null, fase: null, titularNome: null, titularCnpj: null, titularCpf: null };
assert.equal(hasStrongScmField(base), false);
assert.equal(hasStrongScmField({ ...base, nup: "48054.x" }), true);
assert.equal(hasStrongScmField({ ...base, fase: "Concessão de Lavra" }), true);
assert.equal(hasStrongScmField({ ...base, titularNome: "MINERACAO X LTDA" }), true);
assert.equal(hasStrongScmField({ ...base, titularCnpj: "11222333000181" }), true);
assert.equal(hasStrongScmField({ ...base, titularCpf: "12345678909" }), true);

// 5. parseEventosScmHtml — extração best-effort da tabela de eventos do rawHtml
const paginaComEventos = `
<html><body>
<div id="ctl00_conteudo_upProcesso">
  <table class="BordaTabela">
    <tr class="TituloTabela"><td colspan="4">Eventos do processo</td></tr>
    <tr><td>Evento</td><td>Descrição</td><td>Data do evento</td><td>Publicação D.O.U.</td></tr>
    <tr><td>100</td><td>REQ LAVRA/PROTOCOLO REQUERIMENTO DE LAVRA</td><td>12/05/2024</td><td></td></tr>
    <tr><td>238</td><td>REQ LAVRA/DOCUMENTO DIVERSO PROTOCOLIZADO</td><td>03/07/2024</td><td>10/07/2024</td></tr>
    <tr><td>238</td><td>REQ LAVRA/DOCUMENTO DIVERSO PROTOCOLIZADO</td><td>03/07/2024</td><td>10/07/2024</td></tr>
  </table>
</div>
</body></html>`;
const eventos = parseEventosScmHtml(paginaComEventos);
assert.equal(eventos.length, 2, "linhas duplicadas do layout ASP.NET devem ser deduplicadas");
assert.match(eventos[0].descricao, /PROTOCOLO REQUERIMENTO/, "descrição vem da coluna Descrição, não do código");
assert.ok(eventos[0].data && eventos[0].data.startsWith("2024-05-12"), `data deve sair como ISO (dd/mm/aaaa → aaaa-mm-dd); veio: ${eventos[0].data}`);
assert.ok(eventos[1].data && eventos[1].data.startsWith("2024-07-03"), "segunda data também em ISO");

// páginas sem tabela de eventos → lista vazia (não inventa eventos de outras tabelas)
assert.equal(parseEventosScmHtml(paginaComDados).length, 0, "página de dados básicos não tem eventos");
assert.equal(parseEventosScmHtml(esqueletoVazio).length, 0, "esqueleto vazio não tem eventos");

// tabela que menciona "evento" mas sem coluna de data não é aceita (heurística conservadora)
assert.equal(
  parseEventosScmHtml(`<table><tr><td>Eventos</td></tr><tr><td>REQ LAVRA/ALGO</td></tr></table>`).length,
  0,
  "tabela sem cabeçalho descrição+data deve ser ignorada",
);

console.log("✓ scm-scraper: todos os testes passaram");
process.exit(0); // db pool + setInterval do módulo mantêm o event loop vivo
