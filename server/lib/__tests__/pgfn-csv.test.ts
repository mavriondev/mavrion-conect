import { test } from "node:test";
import assert from "node:assert/strict";
import { pgfnHeader, pgfnRow } from "../pgfn-csv";

for (const count of [13, 15]) {
  test(`PGFN lê layout de ${count} colunas pelo cabeçalho`, () => {
    const names = ["CPF_CNPJ", "TIPO_PESSOA", "TIPO_DEVEDOR", "NOME_DEVEDOR", "UF_DEVEDOR"];
    while (names.length < count - 1) names.push(`EXTRA_${names.length}`);
    names.push("VALOR_CONSOLIDADO");
    const values = names.map(n => ({ CPF_CNPJ: "12345678000199", TIPO_PESSOA: "Pessoa jurídica", NOME_DEVEDOR: "Empresa teste", UF_DEVEDOR: "SP", VALOR_CONSOLIDADO: "123.45" }[n] || ""));
    assert.equal(pgfnRow(values.join(";"), pgfnHeader(names.join(";"))).valor, 123.45);
  });
}
test("não converte valor inválido em zero nem aceita coluna ausente", () => {
  const header = pgfnHeader("VALOR_CONSOLIDADO;CPF_CNPJ;TIPO_PESSOA;NOME_DEVEDOR;UF_DEVEDOR");
  assert.equal(pgfnRow(".00;***123456**;F;Teste;MG", header).valor, 0);
  assert.throws(() => pgfnRow("inválido;123;F;Teste;MG", header));
  assert.throws(() => pgfnHeader("CPF_CNPJ"));
});
