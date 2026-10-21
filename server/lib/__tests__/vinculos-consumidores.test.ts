// Testes de integração dos consumidores decisórios (digest da IA, HTML do
// relatório e prompt da análise minerária): barragem SIGBM casada só por nome
// do empreendedor e certidões consultadas com CNPJ resolvido por nome NUNCA
// viram fato — apenas exibição rotulada como "vinculação não confirmada".
// Rodar com: npx tsx --test server/lib/__tests__/vinculos-consumidores.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { separarBarragensTitular, avisoCertidoesVinculo } from "../consulta-contrato";
import { buildDossieDigest } from "../dossie-digest";
import { buildAssetReportHtml } from "../asset-report";
import { buildMiningAnalysisPrompt } from "../../routes/anm-enrichment";
import { ativoMinaSintetico } from "./fixtures/ativo-mina-sintetico";
import { calcularVigenciaAlvara } from "../vigencia-alvara";

const barragemPorNome = (over: any = {}) => ({
  nome: "Barragem Homônima",
  empreendedor: "Mineração Exemplo Ltda",
  municipio: "Itabirito",
  uf: "MG",
  categoriaRisco: "Alta",
  danoPotencial: "Alto",
  nivelEmergencia: "Sem emergência",
  vinculo: { por: "nome_empreendedor", confirmado: false },
  ...over,
});

const camposVinculosFracos = () => ({
  processoAnm: "832.070/2024",
  anmBarragens: {
    disponivel: true,
    matchPor: "nome_empreendedor",
    doTitular: [barragemPorNome()],
    proximas: [],
    raioKm: 30,
    notaVinculo: "Vinculação por nome do empreendedor — não confirmada por CNPJ.",
    consultadoEm: "2026-08-18T00:00:00Z",
  },
  anmCertidoesTitular: {
    disponivel: true,
    cnpj: "00.000.000/0001-91",
    vinculoConfirmadoPorDocumento: false,
    avisoVinculo: "CNPJ resolvido por nome via agregador comercial (CNPJA) — vinculação não confirmada por documento.",
    pgfn: { temDebitoAtivo: true, situacao: "inscrito em dívida ativa" },
    ceis: { sancionado: false, sancoes: [] },
    consultadoEm: "2026-08-18T00:00:00Z",
  },
});

describe("separarBarragensTitular — vínculo por CNPJ vs nome", () => {
  test("linha com vinculo.confirmado=false vai para não confirmadas", () => {
    const { confirmadas, naoConfirmadas } = separarBarragensTitular({
      doTitular: [barragemPorNome(), barragemPorNome({ nome: "B2", vinculo: { por: "cnpj", confirmado: true } })],
    });
    assert.equal(confirmadas.length, 1);
    assert.equal(confirmadas[0].nome, "B2");
    assert.equal(naoConfirmadas.length, 1);
  });
  test("payload matchPor=nome_empreendedor sem vinculo por linha → tudo não confirmado", () => {
    const { confirmadas, naoConfirmadas } = separarBarragensTitular({
      matchPor: "nome_empreendedor",
      doTitular: [{ nome: "Sem marcador" }],
    });
    assert.equal(confirmadas.length, 0);
    assert.equal(naoConfirmadas.length, 1);
  });
  test("payload legado sem nenhum marcador passa como confirmado (sem regressão)", () => {
    const { confirmadas, naoConfirmadas } = separarBarragensTitular({ doTitular: [{ nome: "Legada" }] });
    assert.equal(confirmadas.length, 1);
    assert.equal(naoConfirmadas.length, 0);
  });
});

describe("avisoCertidoesVinculo — herança da proveniência do CNPJ", () => {
  test("null para payload legado ou vínculo confirmado", () => {
    assert.equal(avisoCertidoesVinculo(null), null);
    assert.equal(avisoCertidoesVinculo({}), null);
    assert.equal(avisoCertidoesVinculo({ vinculoConfirmadoPorDocumento: true }), null);
  });
  test("usa o avisoVinculo do payload quando presente; senão texto padrão", () => {
    assert.match(avisoCertidoesVinculo({ vinculoConfirmadoPorDocumento: false, avisoVinculo: "aviso X" })!, /aviso X/);
    assert.match(avisoCertidoesVinculo({ vinculoConfirmadoPorDocumento: false })!, /vinculação não confirmada/);
  });
});

describe("digest do dossiê (insumos da IA)", () => {
  test("barragem casada só por nome fica FORA do digest, com nota de exclusão", () => {
    const digest = buildDossieDigest(camposVinculosFracos(), ["barragens"]);
    assert.match(digest, /excluída\(s\) dos insumos — vinculação não confirmada/);
    assert.doesNotMatch(digest, /Barragem Homônima/);
  });
  test("certidões com CNPJ resolvido por nome carregam a marca de NÃO fato", () => {
    const digest = buildDossieDigest(camposVinculosFracos(), ["certidoes"]);
    assert.match(digest, /VINCULAÇÃO NÃO CONFIRMADA POR DOCUMENTO/);
    assert.match(digest, /NÃO tratar como fato do titular/);
  });
});

describe("HTML do relatório (PDF)", () => {
  test("barragens por nome em tabela separada rotulada; certidões com aviso de vínculo", () => {
    const ativo = ativoMinaSintetico() as any;
    Object.assign(ativo.camposEspecificos, {
      anmBarragens: camposVinculosFracos().anmBarragens,
      anmCertidoesTitular: camposVinculosFracos().anmCertidoesTitular,
    });
    const html = buildAssetReportHtml(ativo);
    assert.match(html, /Barragens casadas apenas por nome do empreendedor \(1\) — vinculação não confirmada/);
    assert.doesNotMatch(html, /Barragens do titular \(/);
    assert.match(html, /não geram alerta nem entram nos insumos da IA|não confirmada por CNPJ/);
    assert.match(html, /Vínculo do CNPJ/);
    assert.match(html, /NÃO confirmado por documento/);
  });
});

describe("prompt da análise minerária", () => {
  test("barragem por nome não vira fato do titular; certidões levam aviso destacado", () => {
    const prompt = buildMiningAnalysisPrompt(
      { name: "Ativo Teste", type: "MINA" },
      camposVinculosFracos(),
      {},
      calcularVigenciaAlvara([]),
      null,
      null,
    );
    assert.match(prompt, /Nenhuma barragem vinculada ao titular por CNPJ; 1 casada\(s\) apenas por nome/);
    assert.doesNotMatch(prompt, /\*\*Barragens do titular:\*\*/);
    assert.match(prompt, /ATENÇÃO — vinculação não confirmada por documento/);
    assert.match(prompt, /NÃO tratar os resultados abaixo como fato do titular/);
  });
  test("barragem confirmada por CNPJ continua entrando como fato", () => {
    const campos = camposVinculosFracos() as any;
    campos.anmBarragens.matchPor = "cnpj";
    campos.anmBarragens.doTitular = [barragemPorNome({ vinculo: { por: "cnpj", confirmado: true } })];
    const prompt = buildMiningAnalysisPrompt(
      { name: "Ativo Teste", type: "MINA" },
      campos,
      {},
      calcularVigenciaAlvara([]),
      null,
      null,
    );
    assert.match(prompt, /\*\*Barragens do titular:\*\* 1/);
  });

  test("recebe a vigência pronta e não expõe eventos crus capazes de recalculá-la", () => {
    const vigencia = calcularVigenciaAlvara([
      { data: "13/09/2021", descricao: "ALVARÁ DE PESQUISA PUBLICADO — prazo 3 anos" },
      { data: "20/10/2021", descricao: "VENCIMENTO DO ALVARÁ ALTERADO PARA 01/10/2024" },
      { data: "28/04/2025", descricao: "PRORROGAÇÃO DO ALVARÁ PUBLICADA — prazo 3 anos" },
    ]);
    const prompt = buildMiningAnalysisPrompt(
      { title: "Ativo Teste", type: "MINA" },
      {
        processoAnm: "861261/2021",
        ultimoEventoAnm: "PRORROGAÇÃO DO ALVARÁ POR 3 ANOS",
        anmDou: {
          disponivel: true,
          total: 1,
          publicacoes: [{ data: "13/09/2026", trecho: "Prorrogação do alvará por três anos" }],
        },
      },
      {},
      vigencia,
      null,
      null,
      "Documento: o vencimento do alvará seria 13/09/2026.",
    );
    assert.match(prompt, /VIGÊNCIA CANÔNICA DO ALVARÁ/);
    assert.match(prompt, /01\/10\/2027/);
    assert.doesNotMatch(prompt, /Histórico de Eventos|13\/09\/2026|PRORROGAÇÃO DO ALVARÁ POR 3 ANOS/);
    assert.match(prompt, /Trecho relacionado à vigência omitido/);
  });

  test("vigência indeterminada não expõe validade cadastrada como fallback", () => {
    const prompt = buildMiningAnalysisPrompt(
      { title: "Ativo Teste", type: "MINA" },
      { processoAnm: "861261/2021", validadeAnm: "13/09/2026" },
      {},
      calcularVigenciaAlvara([]),
      null,
      null,
    );
    assert.match(prompt, /VIGÊNCIA CANÔNICA DO ALVARÁ: INDETERMINADA/);
    assert.doesNotMatch(prompt, /13\/09\/2026|Validade cadastrada/);
  });
});

describe("HTML do relatório — sanidade numérica chega ao renderizador", () => {
  test("valores reprovados aparecem como 'a verificar — motivo' e nunca como par numérico", () => {
    const ativo = ativoMinaSintetico() as any;
    const c = ativo.camposEspecificos;
    // SIGEF: parcela reprovada + cobertura reprovada
    c.sigefParcelas.parcelas.push({
      codigoParcela: "SAN-SIGEF-1", nomeArea: "Gleba Sanidade", detentor: "Detentor X",
      areaHa: 10, relacao: "sobreposta",
      sobreposicaoHa: null, sobreposicaoPct: null,
      sobreposicaoAVerificar: "interseção (999 ha) excede a área da parcela (10 ha)",
    });
    c.sigefParcelas.coberturaPct = null;
    c.sigefParcelas.coberturaAVerificar = "cobertura certificada calculada acima de 100%";
    // CAR: imóvel reprovado + cobertura reprovada
    c.carImoveis.imoveis.push({
      codImovel: "MG-0000000-SANIDADE", municipio: "Itabirito", uf: "MG",
      areaHa: 5, relacao: "sobreposto", status: "AT", condicao: "Ativa", tipo: "IRU",
      sobreposicaoHa: null, sobreposicaoPct: null,
      sobreposicaoAVerificar: "percentual de sobreposição CAR reprovado (150%)",
    });
    c.carImoveis.totalSobrepostos = (c.carImoveis.totalSobrepostos || 0) + 1;
    c.carImoveis.coberturaPct = null;
    c.carImoveis.coberturaAVerificar = "cobertura CAR calculada acima de 100%";
    // CCIR consolidado: registro com números presentes mas reprovados —
    // o marcador tem prioridade e o par numérico NUNCA é exibido
    c.ccirImoveis.imoveis.push({
      codigoIncra: "999999999999", codigoCar: null, denominacao: "Imóvel Sanidade",
      detentores: ["Detentor Y"], situacao: null, areaHa: 5,
      sobreposicaoHa: 888, sobreposicaoPct: 143,
      sobreposicaoAVerificar: "interseção somada excede a área do imóvel",
      origem: "SIGEF", parcelas: ["SAN-SIGEF-1"],
    });
    const html = buildAssetReportHtml(ativo);
    assert.match(html, /a verificar — interseção \(999 ha\) excede a área da parcela \(10 ha\)/);
    assert.match(html, /a verificar — cobertura certificada calculada acima de 100%/);
    assert.match(html, /a verificar — percentual de sobreposição CAR reprovado \(150%\)/);
    assert.match(html, /a verificar — cobertura CAR calculada acima de 100%/);
    assert.match(html, /a verificar — interseção somada excede a área do imóvel/);
    // o par reprovado (888 ha / 143%) jamais aparece formatado como valor
    assert.doesNotMatch(html, /888 ha/);
    assert.doesNotMatch(html, /143%/);
  });
});
