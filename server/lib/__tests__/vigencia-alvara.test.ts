import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  anexarVigenciaCalculada,
  calcularVigenciaAlvara,
  contextoVigenciaMinerariaParaPrompt,
  hashInsumosVigenciaDoAtivo,
  obterVigenciaCalculada,
  textoLegadoSemConflitoVigencia,
  validarConsistenciaVigenciaTexto,
} from "../vigencia-alvara";

const eventos861261 = [
  {
    data: "13/09/2021",
    descricao: "ALVARÁ DE PESQUISA PUBLICADO",
    publicacaoDou: "Prazo de 3 anos",
  },
  {
    data: "20/10/2021",
    descricao: "VENCIMENTO DO ALVARÁ DE PESQUISA ALTERADO PELA RESOLUÇÃO ANM 76/2021 PARA 01/10/2024",
  },
  {
    data: "28/04/2025",
    descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA PUBLICADA",
    publicacaoDou: "Prazo de 3 anos",
  },
];

describe("calcularVigenciaAlvara", () => {
  test("aplica alteração à base vigente e soma a prorrogação sobre a data alterada", () => {
    const resultado = calcularVigenciaAlvara(eventos861261);
    assert.equal(resultado.status, "determinado");
    assert.equal(resultado.dataVigenciaAtual, "01/10/2027");
    assert.equal(resultado.dataVigenciaIso, "2027-10-01");
    assert.equal(
      resultado.memoriaCalculo,
      "13/09/2021 (+3a) → 13/09/2024 → [alterado por Res. 76/2021] → 01/10/2024 → [+3a prorrogação 28/04/2025] → 01/10/2027",
    );
    assert.deepEqual(resultado.etapas.map((e) => e.dataResultante), ["13/09/2024", "01/10/2024", "01/10/2027"]);
  });

  test("ordena eventos e aceita datas ISO sem mudar o resultado", () => {
    const foraDeOrdem = [
      { ...eventos861261[2], data: "2025-04-28" },
      { ...eventos861261[0], data: "2021-09-13" },
      { ...eventos861261[1], data: "2021-10-20" },
    ];
    assert.equal(calcularVigenciaAlvara(foraDeOrdem).dataVigenciaAtual, "01/10/2027");
  });

  test("não aceita prorrogação sem duração explícita", () => {
    const resultado = calcularVigenciaAlvara([
      eventos861261[0],
      eventos861261[1],
      { data: "28/04/2025", descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA PUBLICADA" },
    ]);
    assert.equal(resultado.status, "indeterminado");
    assert.equal(resultado.dataVigenciaAtual, null);
    assert.match(resultado.motivosIndeterminacao.join(" "), /sem duração explícita/);
  });

  test("não aplica pedido, indeferimento ou revogação como ato eficaz", () => {
    const indeferida = calcularVigenciaAlvara([
      eventos861261[0],
      eventos861261[1],
      {
        data: "28/04/2025",
        descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA POR 3 ANOS INDEFERIDA",
      },
    ]);
    assert.equal(indeferida.status, "indeterminado");
    assert.match(indeferida.motivosIndeterminacao.join(" "), /sem eficácia expressa/);

    const pedido = calcularVigenciaAlvara([
      eventos861261[0],
      {
        data: "28/04/2025",
        descricao: "REQUERIMENTO DE PRORROGAÇÃO DO ALVARÁ DE PESQUISA POR 3 ANOS",
      },
    ]);
    assert.equal(pedido.status, "indeterminado");

    const revogada = calcularVigenciaAlvara([
      eventos861261[0],
      {
        data: "10/01/2024",
        descricao: "ALVARÁ DE PESQUISA REVOGADO",
      },
    ]);
    assert.equal(revogada.status, "indeterminado");
    assert.match(revogada.motivosIndeterminacao.join(" "), /extintivo/);
  });

  test("texto de IA com data errada não altera a saída estruturada", () => {
    const resultado = calcularVigenciaAlvara(eventos861261);
    const legado = "O vencimento do alvará é 13/09/2026, conforme nossa estimativa.";
    assert.equal(resultado.dataVigenciaAtual, "01/10/2027");
    assert.equal(textoLegadoSemConflitoVigencia(legado, resultado), null);
    assert.equal(
      textoLegadoSemConflitoVigencia("A vigência atual do alvará é 01/10/2027.", resultado),
      "A vigência atual do alvará é 01/10/2027.",
    );
  });
});

test("contexto minerário entrega a vigência pronta e proíbe recálculo", () => {
  const contexto = contextoVigenciaMinerariaParaPrompt(calcularVigenciaAlvara(eventos861261));
  assert.match(contexto, /VIGÊNCIA CANÔNICA DO ALVARÁ/);
  assert.match(contexto, /01\/10\/2027/);
  assert.match(contexto, /NÃO RECALCULAR/);
});

test("objeto anexado é a fonte única e memória persistida stale não prevalece", () => {
  const ativoAntigo: any = {
    type: "MINA",
    camposEspecificos: {
      processoAnm: "861261/2021",
      anmHistorico: { eventos: eventos861261.slice(0, 2) },
    },
  };
  const preparadoAntigo = anexarVigenciaCalculada(ativoAntigo);
  const vigenciaAntiga = obterVigenciaCalculada(preparadoAntigo);
  const persistidaAntiga = {
    ...vigenciaAntiga,
    insumosHash: hashInsumosVigenciaDoAtivo(ativoAntigo),
  };

  const ativoAtual: any = {
    type: "MINA",
    camposEspecificos: {
      processoAnm: "861261/2021",
      anmHistorico: { eventos: eventos861261 },
      vigenciaAlvaraCalculada: persistidaAntiga,
    },
  };
  const preparadoAtual = anexarVigenciaCalculada(ativoAtual);
  assert.equal(obterVigenciaCalculada(preparadoAtual).dataVigenciaAtual, "01/10/2027");
  assert.strictEqual(anexarVigenciaCalculada(preparadoAtual), preparadoAtual);
});

describe("validarConsistenciaVigenciaTexto", () => {
  const resultado = calcularVigenciaAlvara(eventos861261);

  test("libera relatório quando todas as afirmações usam a data canônica", () => {
    assert.doesNotThrow(() => validarConsistenciaVigenciaTexto(
      "Vigência atual: 01/10/2027. O alvará é válido até 01/10/2027.",
      resultado,
    ));
  });

  test("bloqueia relatório com data conflitante e registra a ocorrência", () => {
    assert.throws(
      () => validarConsistenciaVigenciaTexto(
        "Parecer: vigência atual 01/10/2027. Investigação: o vencimento do alvará é 13/09/2026.",
        resultado,
      ),
      /Relatório bloqueado.*01\/10\/2027.*13\/09\/2026/i,
    );
  });

  test("captura 'alvará vence/expira' e ignora validade de licença ambiental", () => {
    assert.throws(
      () => validarConsistenciaVigenciaTexto("O alvará vence em 13/09/2026.", resultado),
      /13\/09\/2026/,
    );
    assert.throws(
      () => validarConsistenciaVigenciaTexto("O alvará expira em 13/09/2026.", resultado),
      /13\/09\/2026/,
    );
    assert.doesNotThrow(() => validarConsistenciaVigenciaTexto(
      "A validade da licença ambiental é 13/09/2026.",
      resultado,
    ));
    assert.doesNotThrow(() => validarConsistenciaVigenciaTexto(
      "No processo ANM 861261/2021, a validade da licença ambiental expira em 13/09/2026.",
      resultado,
    ));
  });

  test("em seção minerária bloqueia menção abreviada sem repetir 'alvará'", () => {
    assert.throws(
      () => validarConsistenciaVigenciaTexto(
        "Investigação minerária\nA validade é 13/09/2026.",
        resultado,
        { escopoMinerario: true },
      ),
      /13\/09\/2026/,
    );
    assert.equal(
      textoLegadoSemConflitoVigencia("A validade é 13/09/2026.", resultado),
      null,
    );
  });
});