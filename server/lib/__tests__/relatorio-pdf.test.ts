// Teste de integração de PDF REAL: gera o relatório pelo caminho completo
// (renderAssetReportPdf → Chromium/puppeteer) com o ativo MINA sintético e
// valida o TEXTO extraído do PDF (pdf-parse v2): campos do Processo
// abastecidos pelo SCM sem placeholder, aviso de TAH ambígua, nota explícita
// de histórico indisponível, quadro com as 6 camadas de restrição,
// sobreposições em "X ha (Y%)" e telemetria de fontes indisponíveis.
// Rodar com: npx tsx --test server/lib/__tests__/relatorio-pdf.test.ts
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { renderAssetReportPdf } from "../asset-report";
import { CAMADAS_RESTRICAO } from "../relatorio-vinculos";
import { ativoMinaSintetico } from "./fixtures/ativo-mina-sintetico";

// normaliza o texto extraído: junta espaços/quebras para casar frases inteiras
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("renderAssetReportPdf — PDF real do ativo MINA sintético", () => {
  let texto = "";

  before(async () => {
    const pdf = await renderAssetReportPdf(ativoMinaSintetico());
    assert.ok(pdf.length > 1000, "PDF gerado deve ter conteúdo");
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const res = await parser.getText();
    texto = norm(res.text);
    assert.ok(texto.length > 200, "texto extraído do PDF deve ter conteúdo");
  });

  test("campos do Processo vindos do SCM aparecem preenchidos, sem '—'", () => {
    // valores que só existem no SCM devem sobreviver à renderização do PDF
    assert.match(texto, /REQUERIMENTO DE LAVRA/);
    assert.match(texto, /MINERADORA SINTETICA LTDA/);
    assert.match(texto, /48054\.000001\/2024-01/); // NUP
    assert.match(texto, /12\.345\.678\/0001-99/); // CNPJ formatado (Titular Oficial)
    // nenhum rótulo com fonte alternativa fica com placeholder
    for (const label of ["Fase", "Titular", "Situação", "UF", "NUP"]) {
      assert.ok(!new RegExp(`${label}\\s*—`).test(texto), `campo '${label}' apareceu vazio ('—') no PDF`);
    }
  });

  test("TAH ambígua vira aviso, sem titulares de outros anos", () => {
    assert.match(texto, /TAH — Taxa Anual por Hectare/);
    assert.match(texto, /ambíguo/i);
    assert.ok(!texto.includes("Titular Antigo A"));
    assert.ok(!texto.includes("Titular Recente"));
  });

  test("histórico sem eventos reais vira nota explícita, nunca tabela falsa nem omissão", () => {
    assert.ok(!/Histórico \(\d+ evento/.test(texto));
    assert.match(texto, /Histórico de eventos ANM não disponível/);
  });

  test("sobreposição em 'X ha (Y% do polígono)' com composição rotulada e metodologia", () => {
    assert.match(texto, /423,23 ha \(2,39% do polígono\)/);
    assert.match(texto, /477,15 ha \(3,16% do polígono\)/);
    assert.match(texto, /soma de 2 parcelas SIGEF/);
    assert.match(texto, /Metodologia: cada linha consolida TODAS as parcelas SIGEF/);
  });

  test("parecer IA indisponível e telemetria de fontes aparecem no PDF", () => {
    assert.match(texto, /Parecer Consolidado \(disciplina de certeza\)/);
    assert.match(texto, /indisponível nesta geração/);
    assert.match(texto, /Disponibilidade das fontes nesta geração/);
    assert.match(texto, /timeout na Imprensa Nacional/);
  });

  test("disciplina de certeza: lacunas estruturadas e score de completude no PDF", () => {
    assert.match(texto, /Lacunas do Dossiê \(o que falta e como obter\)/);
    assert.match(texto, /Não é possível concluir sobre/);
    assert.match(texto, /Score de Completude do Dossiê/);
    assert.match(texto, /componentes presentes/); // fórmula visível junto do score
  });

  test("nenhum vocabulário proibido nem score de confiança no corpo do PDF", () => {
    for (const termo of [
      "possivelmente", "provavelmente", "aparentemente", "estima-se",
      "acredita-se", "tudo indica", "não se descarta", "via de regra", "sugere-se",
    ]) {
      assert.ok(!texto.toLowerCase().includes(termo), `vocabulário proibido no PDF: ${termo}`);
    }
    assert.ok(!/score de confiança/i.test(texto), "nenhum score de confiança em nenhuma saída");
    assert.ok(!/índice de prontidão/i.test(texto), "Índice de Prontidão não pode reaparecer");
    assert.ok(!/due diligence/i.test(texto), "seção de Due Diligence de IA não pode reaparecer");
    assert.ok(!/score de atratividade/i.test(texto));
  });

  test("quadro de restrições lista as 6 camadas e trava o semáforo", () => {
    assert.match(texto, /Restrições Ambientais e Fundiárias/);
    for (const cam of CAMADAS_RESTRICAO) {
      assert.ok(texto.includes(norm(cam.label)), `camada ausente no PDF: ${cam.label}`);
    }
    assert.match(texto, /Camadas NÃO consultadas/);
    assert.match(texto, /AMARELO/);
    assert.ok(!texto.includes("VERDE —"));
  });
});

describe("renderAssetReportPdf — vigência única do processo 861261/2021", () => {
  test("publica 01/10/2027, exibe a memória e omite narrativa legada conflitante/duplicada", async () => {
    const resumoLegado = "Resumo executivo minerário: a validade é 13/09/2026.";
    const asset = ativoMinaSintetico({
      processoAnm: "861261/2021",
      validadeAnm: "13/09/2026",
      anmHistorico: {
        fonte: "Eventos ANM (Cadastro Mineiro)",
        consultadoEm: "2026-08-19T12:00:00Z",
        eventos: [
          {
            data: "28/04/2025",
            descricao: "PRORROGAÇÃO DO ALVARÁ DE PESQUISA PUBLICADA",
            publicacaoDou: "Prazo de 3 anos",
          },
          {
            data: "13/09/2021",
            descricao: "ALVARÁ DE PESQUISA PUBLICADO",
            publicacaoDou: "Prazo de 3 anos",
          },
          {
            data: "20/10/2021",
            descricao: "VENCIMENTO DO ALVARÁ DE PESQUISA ALTERADO PELA RESOLUÇÃO ANM 76/2021 PARA 01/10/2024",
          },
        ],
      },
      iaDeepIntel: {
        resumoInvestigacao: resumoLegado,
        contatos: [],
        restricoes: [],
      },
      iaEnrichment: {
        resumoExecutivo: resumoLegado,
      },
    });

    const pdf = await renderAssetReportPdf(asset);
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    const res = await parser.getText();
    const textoVigencia = norm(res.text);

    assert.match(textoVigencia, /Vigência atual do alvará/);
    assert.match(textoVigencia, /Vigência atual 01\/10\/2027/);
    assert.match(
      textoVigencia,
      /13\/09\/2021 \(\+3a\).*13\/09\/2024.*Res\. 76\/2021.*01\/10\/2024.*\+3a prorrogação 28\/04\/2025.*01\/10\/2027/,
    );
    assert.ok(!textoVigencia.includes("13/09/2026"), "data legada conflitante não pode chegar ao PDF");
    assert.equal((textoVigencia.match(/Narrativa legada omitida/g) || []).length, 1, "duplicata Investigação/Resumo é suprimida");
  });
});
