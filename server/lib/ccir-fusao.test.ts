// Testes da consolidação da base fundiária (CCIR do ativo minerário).
// Rodar com: npx tsx --test server/lib/ccir-fusao.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidarImoveisFundiarios, rotuloOrigemImovel } from "./ccir-fusao";

const parcelaSigef = (over: any = {}) => ({
  codigoParcela: "p1",
  codigoImovel: "950.000.111.222-3",
  nomeArea: "Fazenda Grão Pará",
  situacao: "Registrada",
  status: null,
  registroMatricula: "M-123",
  detentor: "João da Silva",
  municipioIbge: 3132503,
  areaHa: 100,
  sobreposicaoPct: 26.57,
  relacao: "sobreposta",
  ...over,
});

const imovelCar = (over: any = {}) => ({
  codImovel: "MG-3132503-AAA",
  municipio: "Itabirito",
  uf: "MG",
  municipioIbge: 3132503,
  areaHa: 120,
  status: "Ativo",
  condicao: "Aguardando análise",
  sobreposicaoPct: 26.57,
  relacao: "sobreposto",
  ...over,
});

test("caso simples: parcela SIGEF casada com imóvel CAR vira um único registro SIGEF+CAR", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef()],
    [imovelCar(), imovelCar({ codImovel: "MG-3132503-BBB", sobreposicaoPct: 10 })],
    new Map([["p1", "MG-3132503-AAA"]]),
  );
  assert.equal(imoveis.length, 2);
  const fundido = imoveis.find((i) => i.codigoCar === "MG-3132503-AAA")!;
  assert.equal(fundido.origem, "SIGEF+CAR");
  assert.equal(fundido.codigoIncra, "950.000.111.222-3");
  assert.deepEqual(fundido.detentores, ["João da Silva"]);
  assert.equal(fundido.municipio, "Itabirito");
  // CAR sem correspondência permanece como entrada própria
  const soCar = imoveis.find((i) => i.codigoCar === "MG-3132503-BBB")!;
  assert.equal(soCar.origem, "CAR");
});

test("dois códigos INCRA/SIGEF dentro do mesmo CAR coalescem num único registro", () => {
  const imoveis = consolidarImoveisFundiarios(
    [
      parcelaSigef({ codigoParcela: "p1", codigoImovel: "950.000.111.222-3", detentor: "João da Silva", areaHa: 60, sobreposicaoPct: 15 }),
      parcelaSigef({ codigoParcela: "p2", codigoImovel: "950.000.999.888-7", nomeArea: null, detentor: "Maria Souza", registroMatricula: null, areaHa: 40, sobreposicaoPct: 11.57 }),
    ],
    [imovelCar()],
    new Map([
      ["p1", "MG-3132503-AAA"],
      ["p2", "MG-3132503-AAA"],
    ]),
  );
  assert.equal(imoveis.length, 1);
  const unico = imoveis[0];
  assert.equal(unico.origem, "SIGEF+CAR");
  assert.equal(unico.codigoCar, "MG-3132503-AAA");
  // preserva os dois códigos INCRA
  assert.ok(unico.codigoIncra!.includes("950.000.111.222-3"));
  assert.ok(unico.codigoIncra!.includes("950.000.999.888-7"));
  // funde detentores, parcelas e soma áreas/sobreposição
  assert.deepEqual(unico.detentores.sort(), ["João da Silva", "Maria Souza"]);
  assert.deepEqual(unico.parcelas.sort(), ["p1", "p2"]);
  assert.equal(unico.areaHa, 100);
  assert.equal(unico.sobreposicaoPct, 26.57);
  assert.equal(unico.denominacao, "Fazenda Grão Pará");
});

test("sem casamento geométrico, SIGEF e CAR permanecem separados (comportamento anterior)", () => {
  const imoveis = consolidarImoveisFundiarios([parcelaSigef()], [imovelCar()], new Map());
  assert.equal(imoveis.length, 2);
  assert.deepEqual(imoveis.map((i) => i.origem).sort(), ["CAR", "SIGEF"]);
});

test("múltiplas parcelas do mesmo código INCRA agrupam antes da fusão com o CAR", () => {
  const imoveis = consolidarImoveisFundiarios(
    [
      parcelaSigef({ codigoParcela: "p1", areaHa: 30, sobreposicaoPct: 10 }),
      parcelaSigef({ codigoParcela: "p2", areaHa: 70, sobreposicaoPct: 16.57 }),
    ],
    [imovelCar()],
    new Map([["p2", "MG-3132503-AAA"]]),
  );
  assert.equal(imoveis.length, 1);
  assert.equal(imoveis[0].origem, "SIGEF+CAR");
  assert.equal(imoveis[0].areaHa, 100);
});

test("sobreposicaoHa é somada no agrupamento por código INCRA e preservada no CAR-only", () => {
  const imoveis = consolidarImoveisFundiarios(
    [
      parcelaSigef({ codigoParcela: "p1", areaHa: 30, sobreposicaoPct: 10, sobreposicaoHa: 30 }),
      parcelaSigef({ codigoParcela: "p2", areaHa: 70, sobreposicaoPct: 16.57, sobreposicaoHa: 70.5 }),
    ],
    [imovelCar({ codImovel: "MG-3132503-CCC", sobreposicaoHa: 12.34 })],
    new Map(),
  );
  const sigef = imoveis.find((i) => i.origem === "SIGEF")!;
  // soma bruta 100,5 ha excede a área do imóvel (100 ha) por arredondamento — a sanidade grampeia no teto físico
  assert.equal(sigef.sobreposicaoHa, 100);
  assert.deepEqual(sigef.parcelas.sort(), ["p1", "p2"]);
  const car = imoveis.find((i) => i.origem === "CAR")!;
  assert.equal(car.sobreposicaoHa, 12.34);
});

test("coalescência via CAR soma sobreposicaoHa dos dois códigos INCRA", () => {
  const imoveis = consolidarImoveisFundiarios(
    [
      parcelaSigef({ codigoParcela: "p1", codigoImovel: "950.000.111.222-3", areaHa: 60, sobreposicaoPct: 15, sobreposicaoHa: 60 }),
      parcelaSigef({ codigoParcela: "p2", codigoImovel: "950.000.999.888-7", areaHa: 40, sobreposicaoPct: 11.57, sobreposicaoHa: 40.15 }),
    ],
    [imovelCar()],
    new Map([
      ["p1", "MG-3132503-AAA"],
      ["p2", "MG-3132503-AAA"],
    ]),
  );
  assert.equal(imoveis.length, 1);
  // soma bruta 100,15 ha grampeada na soma das áreas das parcelas (100 ha) pela sanidade
  assert.equal(imoveis[0].sobreposicaoHa, 100);
});

test("parcela antiga sem sobreposicaoHa mantém null (não inventa 0 ha)", () => {
  const imoveis = consolidarImoveisFundiarios([parcelaSigef()], [], new Map());
  assert.equal(imoveis.length, 1);
  assert.equal(imoveis[0].sobreposicaoHa, null);
});

test("rotuloOrigemImovel — composição explícita de cada número", () => {
  assert.equal(rotuloOrigemImovel({ origem: "SIGEF", parcelas: ["p1"] }), "SIGEF — parcela SIGEF isolada");
  assert.equal(rotuloOrigemImovel({ origem: "SIGEF+CAR", parcelas: ["p1"] }), "consolidado SIGEF+CAR — parcela SIGEF isolada");
  assert.equal(rotuloOrigemImovel({ origem: "SIGEF+CAR", parcelas: ["p1", "p2"] }), "consolidado SIGEF+CAR — soma de 2 parcelas SIGEF");
  assert.match(rotuloOrigemImovel({ origem: "CAR", parcelas: [] }), /CAR sem parcela SIGEF/);
});

test("pareamento abaixo do limiar: os DOIS lados ficam nao_consolidado com motivo", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef({ codigoParcela: "p1" })],
    [imovelCar()],
    new Map(),
    { abaixoLimiar: new Map([["p1", { codImovel: "MG-3132503-AAA", fracaoPct: 42.3 }]]), limiarPct: 60 },
  );
  const sigef = imoveis.find((i) => i.origem === "SIGEF")!;
  assert.equal(sigef.consolidacao, "nao_consolidado");
  assert.match(sigef.consolidacaoMotivo!, /42\.3%/);
  assert.match(sigef.consolidacaoMotivo!, /limiar de 60%/);
  const car = imoveis.find((i) => i.origem === "CAR")!;
  assert.equal(car.consolidacao, "nao_consolidado");
  assert.match(car.consolidacaoMotivo!, /p1/);
});

test("abaixoLimiar aceita Record simples (payload persistido em JSON)", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef({ codigoParcela: "p1" })],
    [],
    new Map(),
    { abaixoLimiar: { p1: { codImovel: "MG-3132503-AAA", fracaoPct: 10 } }, limiarPct: 60 },
  );
  assert.equal(imoveis[0].consolidacao, "nao_consolidado");
});

test("fusão efetiva ganha consolidacao=consolidado", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef()],
    [imovelCar()],
    new Map([["p1", "MG-3132503-AAA"]]),
    { abaixoLimiar: new Map(), limiarPct: 60 },
  );
  const fundido = imoveis.find((i) => i.origem === "SIGEF+CAR")!;
  assert.equal(fundido.consolidacao, "consolidado");
});

test("sanidade: sobreposição maior que a área do imóvel SIGEF vira 'a verificar' (números apagados)", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef({ areaHa: 10, sobreposicaoHa: 50, sobreposicaoPct: 26.57 })],
    [],
    new Map(),
  );
  assert.equal(imoveis[0].sobreposicaoHa, null);
  assert.equal(imoveis[0].sobreposicaoPct, null);
  assert.ok(imoveis[0].sobreposicaoAVerificar);
});

test("sanidade: pct > 100 é reprovado e apagado", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef({ sobreposicaoPct: 140, sobreposicaoHa: 5 })],
    [],
    new Map(),
  );
  assert.equal(imoveis[0].sobreposicaoPct, null);
  assert.ok(imoveis[0].sobreposicaoAVerificar);
});

test("parcela com sobreposicaoAVerificar contamina a soma do imóvel", () => {
  const imoveis = consolidarImoveisFundiarios(
    [parcelaSigef({ sobreposicaoHa: 50, sobreposicaoAVerificar: "interseção excede a área da parcela" })],
    [],
    new Map(),
  );
  assert.equal(imoveis[0].sobreposicaoHa, null);
  assert.equal(imoveis[0].sobreposicaoPct, null);
  assert.ok(imoveis[0].sobreposicaoAVerificar);
});

test("rotuloOrigemImovel anexa o sufixo de pareamento não consolidado", () => {
  assert.match(
    rotuloOrigemImovel({ origem: "SIGEF", parcelas: ["p1"], consolidacao: "nao_consolidado" }),
    /não consolidado \(abaixo do limiar\)/,
  );
  assert.doesNotMatch(
    rotuloOrigemImovel({ origem: "SIGEF+CAR", parcelas: ["p1"], consolidacao: "consolidado" }),
    /não consolidado/,
  );
});
