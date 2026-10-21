// Testes dos critérios de aceite da vinculação de dados do relatório:
// TAH não vaza entre anos, fallback SCM na tabela ANM, histórico vazio
// oculto e listagem completa de camadas de restrição.
// Rodar com: npx tsx --test server/lib/__tests__/relatorio-vinculos.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseProcessoNumeroAno,
  filtrarTahPorProcesso,
  filtrarEventosReais,
  buildProcessoAnmCampos,
  montarQuadroCamadas,
  CAMADAS_RESTRICAO,
  formatSobreposicao,
  faixaAnosEscopo,
  montarNotaEscopoBases,
  avaliarDisponibilidadeModulos,
  gerarMencoesRestricoes,
  mesclarRiscosComRestricoes,
  MARCA_RISCO_INJETADO,
  NOTA_HISTORICO_INDISPONIVEL,
} from "../relatorio-vinculos";
import { buildDossieDigest } from "../dossie-digest";
import { buildAssetReportHtml, buildAssetDigest } from "../asset-report";
import { ativoMinaSintetico } from "./fixtures/ativo-mina-sintetico";

describe("parseProcessoNumeroAno", () => {
  test("número completo com pontos", () => {
    assert.deepEqual(parseProcessoNumeroAno("832.070/2024"), { numero: "832070", ano: 2024 });
  });
  test("só número-base", () => {
    assert.deepEqual(parseProcessoNumeroAno("832070"), { numero: "832070", ano: null });
  });
  test("inválido", () => {
    assert.deepEqual(parseProcessoNumeroAno("abc"), { numero: null, ano: null });
  });
});

describe("filtrarTahPorProcesso — TAH não vaza entre anos", () => {
  const rows = [
    { anoBase: 1989, nomeTitular: "Titular Antigo A" },
    { anoBase: 2005, nomeTitular: "Titular Antigo B" },
    { anoBase: 2024, nomeTitular: "Titular Correto" },
  ];

  test("processo com ano só traz linhas do ano exato", () => {
    const r = filtrarTahPorProcesso(rows, "832070/2024");
    assert.equal(r.ambiguo, false);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].nomeTitular, "Titular Correto");
  });

  test("832070/2024 não traz titulares de 1989", () => {
    const r = filtrarTahPorProcesso(rows, "832.070/2024");
    assert.ok(!r.rows.some((x: any) => x.anoBase === 1989));
  });

  test("processo sem ano é marcado ambíguo", () => {
    const r = filtrarTahPorProcesso(rows, "832070");
    assert.equal(r.ambiguo, true);
    assert.ok(r.motivo);
  });

  test("formato novo com flag ambiguo preserva a flag", () => {
    const r = filtrarTahPorProcesso({ registros: rows, ambiguo: true }, "832070/2024");
    assert.equal(r.ambiguo, true);
  });

  test("ano sem registros correspondentes retorna vazio (nada de dados alheios)", () => {
    const r = filtrarTahPorProcesso(rows, "832070/2020");
    assert.equal(r.rows.length, 0);
    assert.equal(r.ambiguo, false);
  });

  test("snake_case ano_base também funciona", () => {
    const r = filtrarTahPorProcesso([{ ano_base: 2020, nomeTitular: "X" }], "820377/2020");
    assert.equal(r.rows.length, 1);
  });
});

describe("TAH ambígua não alimenta o digest da IA", () => {
  test("digest exclui TAH quando processo não tem ano", () => {
    const digest = buildDossieDigest(
      { processoAnm: "832070", anmTah: [{ anoBase: 1989, nomeTitular: "Alheio" }] },
      ["tah"],
    );
    assert.ok(!digest.includes("TAH"));
  });
  test("digest inclui TAH quando vínculo é exato", () => {
    const digest = buildDossieDigest(
      { processoAnm: "832070/2024", anmTah: [{ anoBase: 2024, nomeTitular: "Correto" }] },
      ["tah"],
    );
    assert.ok(digest.includes("TAH"));
    assert.ok(digest.includes("Correto"));
  });
});

describe("filtrarEventosReais — histórico vazio fica oculto", () => {
  test("evento que é só o número do processo é descartado", () => {
    const evs = filtrarEventosReais(
      [{ descricao: "832.070/2024", data: null, tipo: "outro" }],
      "832070/2024",
    );
    assert.equal(evs.length, 0);
  });

  test("evento real com data e descrição é mantido", () => {
    const evs = filtrarEventosReais(
      [
        { descricao: "832070/2024", data: null },
        { descricao: "PROTOCOLO DO REQUERIMENTO 12/05/2024", data: "12/05/2024" },
      ],
      "832070/2024",
    );
    assert.equal(evs.length, 1);
    assert.match(evs[0].descricao, /PROTOCOLO/);
  });

  test("lixo sem data e sem letras é descartado", () => {
    const evs = filtrarEventosReais([{ descricao: "123456", data: null }], "832070/2024");
    assert.equal(evs.length, 0);
  });

  test("lista vazia/nula retorna vazio", () => {
    assert.equal(filtrarEventosReais(null, "832070/2024").length, 0);
    assert.equal(filtrarEventosReais([], "832070/2024").length, 0);
  });
});

describe("buildProcessoAnmCampos — fallback SCM, nunca '—' quando o dado existe", () => {
  const asset = { estado: null, areaHa: null };

  test("cai para o SCM quando live/cadastro não têm o dado", () => {
    const scm = { fase: "REQUERIMENTO DE LAVRA", titularNome: "MINERADORA X", uf: "MG", areaHa: 49.2, nup: "48054.000001/2024-01", consultadoEm: "2026-08-10T12:00:00Z", statusAtivo: true };
    const campos = buildProcessoAnmCampos(asset, { processoAnm: "832070/2024" }, scm);
    const by = (l: string) => campos.find(c => c.label === l);
    assert.equal(by("Fase")!.valor, "REQUERIMENTO DE LAVRA");
    assert.match(by("Fase")!.fonte!, /SCM/);
    assert.match(by("Fase")!.fonte!, /cache de/);
    assert.equal(by("Titular")!.valor, "MINERADORA X");
    assert.equal(by("Situação")!.valor, "Ativo");
  });

  test("prefere cadastro e ao vivo quando existem", () => {
    const c = { processoAnm: "832070/2024", faseAnm: "CONCESSÃO DE LAVRA", anmLiveData: { features: [{ attributes: { NOME: "TITULAR LIVE" } }] }, anmLiveDataUpdatedAt: "2026-08-12T00:00:00Z" };
    const campos = buildProcessoAnmCampos(asset, c, { fase: "OUTRA", titularNome: "TITULAR SCM" });
    const by = (l: string) => campos.find(cc => cc.label === l);
    assert.equal(by("Fase")!.valor, "CONCESSÃO DE LAVRA");
    assert.equal(by("Titular")!.valor, "TITULAR LIVE");
    assert.match(by("Titular")!.fonte!, /SIGMINE/);
  });

  test("campos sem valor em nenhuma fonte são omitidos (nunca '—')", () => {
    const campos = buildProcessoAnmCampos(asset, { processoAnm: "832070/2024" }, null);
    assert.ok(!campos.some(c => c.label === "Titular"));
    assert.ok(!campos.some(c => c.valor === "" || c.valor === "—"));
  });
});

describe("montarQuadroCamadas — listagem completa de camadas", () => {
  test("todas as camadas sempre aparecem, mesmo sem dados", () => {
    const quadro = montarQuadroCamadas({});
    assert.equal(quadro.linhas.length, CAMADAS_RESTRICAO.length);
    assert.equal(quadro.falhadas.length, CAMADAS_RESTRICAO.length);
    assert.ok(quadro.linhas.every(l => l.status === "Camada não consultada"));
  });

  test("camada falhada vira 'não consultada' e trava o verde", () => {
    const camadaOk = { consultado: true, sobreposicao: false, total: 0, ocorrencias: [], sobreposicoes: [] };
    const c = {
      anmFunai: { sobreposicao: false },
      anmFunaiTerras: { total: 0, data: [] },
      anmRestricoes: {
        semaforo: "verde",
        raio_km: 25,
        camadas: {
          unidadesConservacao: camadaOk,
          embargos: camadaOk,
          quilombolas: { consultado: false },
          assentamentos: camadaOk,
          cavernas: { consultado: true, total: 0, ocorrencias: [] },
        },
      },
    };
    const quadro = montarQuadroCamadas(c);
    assert.equal(quadro.linhas.length, 6);
    assert.deepEqual(quadro.falhadas, ["Territórios quilombolas (IBGE/INCRA)"]);
    assert.equal(quadro.semaforo, "amarelo");
  });

  test("tudo consultado e sem ocorrências = verde; sobreposição = vermelho", () => {
    const camadaOk = { consultado: true, sobreposicao: false, total: 0, ocorrencias: [], sobreposicoes: [] };
    const base = {
      anmFunai: { sobreposicao: false },
      anmFunaiTerras: { total: 0, data: [] },
      anmRestricoes: {
        raio_km: 25,
        camadas: {
          unidadesConservacao: camadaOk, embargos: camadaOk, quilombolas: camadaOk,
          assentamentos: camadaOk, cavernas: { consultado: true, total: 0, ocorrencias: [] },
        },
      },
    };
    assert.equal(montarQuadroCamadas(base).semaforo, "verde");
    const comSobre = JSON.parse(JSON.stringify(base));
    comSobre.anmRestricoes.camadas.unidadesConservacao.sobreposicao = true;
    assert.equal(montarQuadroCamadas(comSobre).semaforo, "vermelho");
  });

  test("FUNAI presente conta como consultada com ocorrências", () => {
    const quadro = montarQuadroCamadas({ anmFunaiTerras: { total: 2, raio_km: 50, data: [{ terrai_nome: "TI Exemplo", distancia_km: 12 }] } });
    const funai = quadro.linhas.find(l => l.key === "funai")!;
    assert.equal(funai.consultada, true);
    assert.match(funai.status, /2 ocorrência/);
    assert.match(funai.destaque, /TI Exemplo/);
  });
});

describe("formatSobreposicao — 'X ha (Y% do polígono)' consistente", () => {
  test("ha + % juntos, formato pt-BR", () => {
    assert.equal(formatSobreposicao(423.23, 2.39), "423,23 ha (2,39% do polígono)");
    assert.equal(formatSobreposicao(477.15, 3.16), "477,15 ha (3,16% do polígono)");
    assert.equal(formatSobreposicao(1955.42, 100), "1.955,42 ha (100% do polígono)");
  });
  test("dados antigos sem ha mostram só % (não inventa 0 ha)", () => {
    assert.equal(formatSobreposicao(null, 3.16), "3,16% do polígono");
    assert.equal(formatSobreposicao(undefined, 3.16), "3,16% do polígono");
  });
  test("só ha, sem %", () => {
    assert.equal(formatSobreposicao(10, null), "10 ha");
  });
  test("nada vira travessão", () => {
    assert.equal(formatSobreposicao(null, null), "—");
  });
});

describe("escopo das bases — conclusões negativas sempre qualificadas", () => {
  test("faixa de anos", () => {
    assert.equal(faixaAnosEscopo({ anoMin: 2002, anoMax: 2026 }), "2002–2026");
    assert.equal(faixaAnosEscopo({ anoMin: 2026, anoMax: 2026 }), "2026");
    assert.equal(faixaAnosEscopo(null), "período não determinado nesta geração");
  });
  test("nota cita TAH, CFEM e DOU com períodos", () => {
    const nota = montarNotaEscopoBases({ tah: { anoMin: 2002, anoMax: 2026 }, cfem: { anoMin: 2004, anoMax: 2026 } });
    assert.match(nota, /TAH \(2002–2026\)/);
    assert.match(nota, /CFEM \(2004–2026\)/);
    assert.match(nota, /DOU \(Imprensa Nacional\)/);
    assert.match(nota, /valem apenas dentro desse escopo/);
  });
  test("sem escopo carregado, deixa claro que o período não foi determinado", () => {
    assert.match(montarNotaEscopoBases(null), /período não determinado nesta geração/);
  });
});

describe("avaliarDisponibilidadeModulos — indisponível ≠ não consultada ≠ sem dado", () => {
  test("payload ausente → fonte não consultada", () => {
    const mods = avaliarDisponibilidadeModulos({});
    assert.ok(mods.length > 0);
    assert.ok(mods.every((m) => m.estado === "nao_consultado"));
  });
  test("disponivel:false → indisponível, com motivo de erro ou message", () => {
    const mods = avaliarDisponibilidadeModulos({
      anmDou: { disponivel: false, message: "timeout" },
      anmCfem: { disponivel: false, erro: "WAF bloqueou" },
    });
    assert.equal(mods.find((m) => m.key === "anmDou")!.estado, "indisponivel");
    assert.equal(mods.find((m) => m.key === "anmDou")!.motivo, "timeout");
    assert.equal(mods.find((m) => m.key === "anmCfem")!.estado, "indisponivel");
    assert.equal(mods.find((m) => m.key === "anmCfem")!.motivo, "WAF bloqueou");
  });
  test("consultado com zero registros continua ok ('sem dado' não é falha)", () => {
    const mods = avaliarDisponibilidadeModulos({
      sigefParcelas: { disponivel: true, totalSobrepostas: 0, parcelas: [] },
      anmTah: [],
    });
    assert.equal(mods.find((m) => m.key === "sigefParcelas")!.estado, "ok");
    assert.equal(mods.find((m) => m.key === "anmTah")!.estado, "ok");
  });
});

describe("menções obrigatórias de restrições nos riscos do parecer", () => {
  const camadaOk = { consultado: true, sobreposicao: false, total: 0, ocorrencias: [], sobreposicoes: [] };
  const cDuasCamadas = {
    anmFunaiTerras: {
      total: 2,
      raio_km: 50,
      data: [{ terrai_nome: "TI Exemplo", distancia_km: 12 }, { terrai_nome: "TI Outra", distancia_km: 20 }],
    },
    anmRestricoes: {
      raio_km: 25,
      camadas: {
        unidadesConservacao: camadaOk,
        embargos: { consultado: true, sobreposicao: false, total: 1, ocorrencias: [{ nome: "Embargo Serra Azul", distancia_km: 3.2 }] },
        quilombolas: camadaOk,
        assentamentos: camadaOk,
        cavernas: camadaOk,
      },
    },
  };

  test("camadas com ocorrência viram menções com nome e distância; zeradas não", () => {
    const mencoes = gerarMencoesRestricoes(montarQuadroCamadas(cDuasCamadas));
    assert.equal(mencoes.length, 2);
    const funai = mencoes.find((m) => m.key === "funai")!;
    assert.match(funai.texto, /TI Exemplo — ~12 km/);
    assert.deepEqual(funai.nomes, ["TI Exemplo", "TI Outra"]);
    assert.match(mencoes.find((m) => m.key === "embargos")!.texto, /Embargo Serra Azul — ~3\.2 km/);
  });

  test("tudo zerado → nenhuma menção obrigatória (camadas podem ir a pontos fortes)", () => {
    const c = {
      anmFunaiTerras: { total: 0, data: [] },
      anmRestricoes: { raio_km: 25, camadas: { unidadesConservacao: camadaOk, embargos: camadaOk, quilombolas: camadaOk, assentamentos: camadaOk, cavernas: camadaOk } },
    };
    assert.equal(gerarMencoesRestricoes(montarQuadroCamadas(c)).length, 0);
  });

  test("IA sem citar nada → injeta todas; nº de camadas não-zero == nº de riscos", () => {
    const quadro = montarQuadroCamadas(cDuasCamadas);
    const naoZero = quadro.linhas.filter((l) => l.consultada && (l.status === "SOBREPOSIÇÃO DIRETA" || /ocorrência\(s\)/.test(l.status)));
    const { riscos, injetados } = mesclarRiscosComRestricoes([], quadro);
    assert.equal(injetados.length, 2);
    assert.equal(riscos.length, naoZero.length);
    assert.ok(riscos.every((r) => r.includes(MARCA_RISCO_INJETADO)));
  });

  test("camada citada pelo NOME da ocorrência não é duplicada", () => {
    const quadro = montarQuadroCamadas(cDuasCamadas);
    const { riscos, injetados } = mesclarRiscosComRestricoes(
      ["A TI Exemplo está a cerca de 12 km do polígono do processo."], quadro);
    assert.equal(injetados.length, 1);
    assert.match(injetados[0], /Embargo Serra Azul/);
    assert.equal(riscos.length, 2);
  });

  test("menção genérica sem nome NÃO conta como citada quando a camada tem nomes (garante nome+distância)", () => {
    const quadro = montarQuadroCamadas(cDuasCamadas);
    const { injetados } = mesclarRiscosComRestricoes(["Há terras indígenas na região."], quadro);
    assert.equal(injetados.length, 2);
  });

  test("camada sem nomes no destaque cai para palavra-chave (não duplica)", () => {
    const c = { anmRestricoes: { raio_km: 25, camadas: { embargos: { consultado: true, sobreposicao: false, total: 3, ocorrencias: [] } } } };
    const quadro = montarQuadroCamadas(c);
    assert.equal(mesclarRiscosComRestricoes([], quadro).injetados.length, 1);
    assert.equal(mesclarRiscosComRestricoes(["Há embargos ambientais vigentes na área."], quadro).injetados.length, 0);
  });
});

describe("buildAssetDigest — quadro de restrições e escopo de bases no insumo da IA", () => {
  test("digest traz QUADRO_RESTRICOES com regra obrigatória e destaques", () => {
    const digest = buildAssetDigest(ativoMinaSintetico());
    assert.match(digest, /QUADRO_RESTRICOES/);
    assert.match(digest, /REGRA OBRIGATORIA/);
    assert.ok(digest.includes("TI Exemplo"));
  });
  test("digest traz ESCOPO_BASES; sem faixas carregadas, período indeterminado", () => {
    const digest = buildAssetDigest(ativoMinaSintetico());
    assert.match(digest, /ESCOPO_BASES/);
    assert.match(digest, /período não determinado nesta geração/);
  });
  test("faixas de anos anexadas pela rota entram no digest (mudam o hash → regeneração)", () => {
    const asset = ativoMinaSintetico();
    (asset as any).__escopoBases = { tah: { anoMin: 2002, anoMax: 2026 }, cfem: { anoMin: 2004, anoMax: 2026 } };
    const digest = buildAssetDigest(asset);
    assert.match(digest, /TAH \(2002–2026\)/);
    assert.match(digest, /CFEM \(2004–2026\)/);
  });
});

describe("buildAssetReportHtml — HTML de ponta a ponta de um ativo MINA sintético", () => {
  const asset = ativoMinaSintetico();
  const html = buildAssetReportHtml(asset);

  // recorta um <div class="sub"> pelo título do h3
  const subBlock = (titulo: string): string | null => {
    const re = new RegExp(`<div class="sub"><h3>${titulo}[^<]*</h3>`);
    const m = re.exec(html);
    if (!m) return null;
    const start = m.index;
    const end = html.indexOf('<div class="sub">', start + 1);
    return html.slice(start, end === -1 ? undefined : end);
  };

  test("tabela do Processo ANM não tem nenhum '—' (fallback SCM preenche)", () => {
    const proc = subBlock("Processo");
    assert.ok(proc, "sub-seção Processo deve existir");
    assert.ok(!proc!.includes("—"), `Processo contém '—': ${proc}`);
    assert.match(proc!, /REQUERIMENTO DE LAVRA/);
    assert.match(proc!, /MINERADORA SINTETICA LTDA/);
    assert.match(proc!, /SCM/); // origem citada
  });

  test("TAH ambígua vira aviso explícito, sem tabela com titulares alheios", () => {
    const tah = subBlock("TAH — Taxa Anual por Hectare");
    assert.ok(tah, "sub-seção TAH deve existir");
    assert.match(tah!, /ambíguo/i);
    assert.ok(!tah!.includes("Titular Antigo A"));
    assert.ok(!tah!.includes("Titular Recente"));
  });

  test("histórico só com evento falso vira nota explícita (nunca tabela falsa nem omissão)", () => {
    assert.ok(!/Histórico \(\d+ evento/.test(html), "não pode renderizar tabela com o evento falso");
    assert.ok(html.includes("Histórico de eventos ANM não disponível"),
      "nota de indisponibilidade deve aparecer no lugar da seção");
  });

  test("quadro de restrições lista as 6 camadas, com falhadas e semáforo travado", () => {
    const rest = subBlock("Restrições Ambientais e Fundiárias");
    assert.ok(rest, "sub-seção de restrições deve existir");
    // 6 camadas na tabela de dados
    for (const cam of CAMADAS_RESTRICAO) {
      assert.ok(rest!.includes(esc6(cam.label)), `camada ausente: ${cam.label}`);
    }
    assert.match(rest!, /Camadas NÃO consultadas/);
    assert.match(rest!, /Camada não consultada não significa ausência/);
    assert.match(rest!, /AMARELO/);
    assert.ok(!rest!.includes("VERDE"));
  });

  test("Titular Oficial (SCM) aparece com CNPJ formatado", () => {
    const tit = subBlock("Titular Oficial \\(SCM/ANM\\)");
    assert.ok(tit, "sub-seção Titular Oficial deve existir");
    assert.match(tit!, /12\.345\.678\/0001-99/);
  });

  test("parecer IA ausente vira seção com nota de indisponibilidade (nunca some)", () => {
    assert.match(html, /Parecer Consolidado \(disciplina de certeza\)/);
    assert.match(html, /indisponível nesta geração/);
  });

  test("sobreposição sai como 'X ha (Y% do polígono)' nas tabelas SIGEF, CAR e consolidada", () => {
    assert.ok(html.includes("423,23 ha (2,39% do polígono)"), "parcela SIGEF isolada");
    assert.ok(html.includes("15,5 ha (0,88% do polígono)"), "imóvel CAR");
    assert.ok(html.includes("477,15 ha (3,16% do polígono)"), "imóvel consolidado (soma de parcelas)");
  });

  test("tabela consolidada rotula a composição e traz nota de metodologia", () => {
    assert.ok(html.includes("consolidado SIGEF+CAR — soma de 2 parcelas SIGEF"));
    assert.ok(html.includes("SIGEF — parcela SIGEF isolada"));
    assert.match(html, /Metodologia: cada linha consolida TODAS as parcelas SIGEF/);
    assert.match(html, /Valores por parcela SIGEF isolada/);
  });

  test("módulo com falha e fonte não consultada aparecem na telemetria", () => {
    assert.match(html, /Disponibilidade das fontes nesta geração/);
    assert.match(html, /Indisponível nesta geração — timeout na Imprensa Nacional/);
    assert.match(html, /Fonte não consultada/);
    assert.ok(html.includes("CFEM — Produção Real (dados abertos ANM)"), "módulo nunca consultado listado");
  });

  test("nota de escopo das bases acompanha a seção TAH (negativas qualificadas)", () => {
    assert.match(html, /Bases consultadas: dados abertos ANM — TAH \(período não determinado nesta geração\)/);
  });
});

describe("buildAssetReportHtml — parecer v3 remonta derivados e ignora prosa persistida", () => {
  const asset = ativoMinaSintetico({
    iaRelatorioConsolidado: {
      versao: 3,
      insumosHash: "hash-antigo-qualquer",
      geradoEm: "2026-08-01T00:00:00Z",
      modelo: "gpt-5.4",
      sintese: [],
      prioridades: [],
      riscos: [{
        categoria: "DERIVADO", tier: "T1",
        texto: "PROSA PERSISTIDA ADULTERADA — NÃO PUBLICAR.",
        fonte: "SCM/ANM (consulta pública)", dataConsulta: "10/08/2026", identificador: "832070",
        regra: "regra adulterada",
        insumos: ["F1 — Fase: REQUERIMENTO DE LAVRA"], origem: "risco",
        templateId: "fase_sem_titulo_de_lavra", fatosIds: ["F1"],
      }],
      encaminhamentos: [],
      hipoteses: [{ texto: "Hipótese rotulada de exemplo.", motivo: "sem fonte oficial" }],
      fatos: [{ id: "F1", campo: "Fase", valor: "REQUERIMENTO DE LAVRA", fonte: "SCM/ANM (consulta pública)", dataConsulta: "10/08/2026", identificador: "832070", tier: "T1" }],
      errosRegistrados: [{ campo: "prioridades", motivo: "enunciado sem fonte — nenhum fato válido do catálogo citado (campo rejeitado e registrado como erro)", texto: "Prioridade sem fato." }],
      lacunasDisciplina: [],
      remocoes: [{ texto: "Frase removida no passo adversarial.", origem: "risco", motivo: "vocabulário proibido: provavelmente" }],
    },
  });
  // A restrição ganhou proveniência completa DEPOIS do cache: deve ser
  // derivada na renderização atual, sem depender de nova chamada de IA.
  asset.camposEspecificos.anmRestricoes.consultadoEm = "2026-08-19T00:00:00Z";
  const html = buildAssetReportHtml(asset);

  test("risco é remontado pelo template usando o fato persistido", () => {
    assert.match(html, /Fase atual do processo: &quot;REQUERIMENTO DE LAVRA&quot;/);
    assert.match(html, /não há concessão de lavra vigente nessa fase/);
    assert.match(html, /template determinístico &quot;fase_sem_titulo_de_lavra&quot;/);
  });

  test("prosa e regra persistidas são ignoradas, mesmo com F-id válido", () => {
    assert.ok(!html.includes("PROSA PERSISTIDA ADULTERADA"));
    assert.ok(!html.includes("regra adulterada"));
    assert.match(html, /F1/, "referência ao fato citado aparece");
  });

  test("restrição atual entra como risco determinístico com fonte, data, vínculo e regra", () => {
    assert.match(html, /Restrição sobre a área do processo — Terras indígenas \(FUNAI\): 2 ocorrência\(s\) no raio/);
    assert.match(html, /Cruzamento de restrições \(INDE\/IBGE\/órgãos oficiais\)/);
    assert.match(html, /consulta 19\/08\/2026/);
    assert.match(html, /id 832070/);
    assert.match(html, /template determinístico &quot;restricao_socioambiental&quot;/);
  });

  test("parecer com hash de insumos antigo ganha aviso de desatualização", () => {
    assert.match(html, /dados do ativo mudaram desde a seleção por IA/);
    assert.match(html, /revalidados contra o catálogo atual/);
  });

  test("fatos citáveis, limitações e hipóteses rotuladas aparecem", () => {
    assert.match(html, /Fatos citáveis atuais usados na análise \(\d+\)/);
    assert.match(html, /Fontes e limitações desta análise/);
    assert.ok(!html.includes("Prioridade sem fato."), "texto bruto rejeitado fica apenas no diagnóstico interno");
    assert.match(html, /enunciado sem fonte/, "motivo do erro registrado é exibido");
    assert.ok(html.includes("Frase removida no passo adversarial."), "remoção do passo adversarial exibida");
    assert.match(html, /Hipóteses \(não verificadas\)/);
    assert.ok(html.includes("Hipótese rotulada de exemplo."));
  });

  test("critério de aceite: nº de camadas não-zero == nº de menções nos riscos", () => {
    const quadro = montarQuadroCamadas(asset.camposEspecificos);
    const naoZero = quadro.linhas.filter((l) => l.consultada && (l.status === "SOBREPOSIÇÃO DIRETA" || /ocorrência\(s\)/.test(l.status)));
    const { riscos } = mesclarRiscosComRestricoes([], quadro);
    assert.equal(riscos.length, naoZero.length);
    assert.equal(naoZero.length, 1); // no fixture, só a FUNAI tem ocorrências
  });
});

describe("buildAssetReportHtml — cache v3 inválido ou contradito só é removido", () => {
  function parecerBase(fatos: any[], riscos: any[]) {
    return {
      versao: 3,
      insumosHash: "hash-antigo",
      geradoEm: "2026-08-01T00:00:00Z",
      modelo: "gpt-5.4",
      sintese: [], prioridades: [], riscos, encaminhamentos: [], hipoteses: [],
      fatos, errosRegistrados: [], lacunasDisciplina: [], remocoes: [],
    };
  }

  test("proveniência vaga sem correspondência atual não é publicada", () => {
    const asset = ativoMinaSintetico({
      iaRelatorioConsolidado: parecerBase(
        [{ id: "F99", campo: "Observação inventada", valor: "Afirmação externa", fonte: "busca web", dataConsulta: "01/08/2026", identificador: "832070", tier: "T1" }],
        [{
          categoria: "DERIVADO", tier: "T1", texto: "TEXTO VAGO NÃO PUBLICAR",
          fonte: "busca web", dataConsulta: "01/08/2026", identificador: "832070",
          regra: "adulterada", insumos: ["F99"], origem: "risco",
          templateId: "fase_sem_titulo_de_lavra", fatosIds: ["F99"],
        }],
      ),
    });
    const html = buildAssetReportHtml(asset);
    assert.ok(!html.includes("TEXTO VAGO NÃO PUBLICAR"));
    assert.ok(!html.includes("Afirmação externa"));
    assert.match(html, /1 item\(ns\) persistido\(s\) não foram publicados/);
  });

  test("mudança estruturada que invalida a regra remove o risco antigo", () => {
    const asset = ativoMinaSintetico({
      iaRelatorioConsolidado: parecerBase(
        [{ id: "F1", campo: "Fase", valor: "REQUERIMENTO DE LAVRA", fonte: "SCM/ANM (consulta pública)", dataConsulta: "10/08/2026", identificador: "832070", tier: "T1" }],
        [{
          categoria: "DERIVADO", tier: "T1", texto: "RISCO ANTIGO NÃO PUBLICAR",
          fonte: "SCM/ANM (consulta pública)", dataConsulta: "10/08/2026", identificador: "832070",
          regra: "adulterada", insumos: ["F1"], origem: "risco",
          templateId: "fase_sem_titulo_de_lavra", fatosIds: ["F1"],
        }],
      ),
    });
    asset.__scmData.fase = "CONCESSÃO DE LAVRA";
    asset.__scmData.consultadoEm = "2026-08-19T00:00:00Z";
    const html = buildAssetReportHtml(asset);
    assert.ok(!html.includes("RISCO ANTIGO NÃO PUBLICAR"));
    assert.ok(!html.includes("não há concessão de lavra vigente nessa fase"));
    assert.match(html, /1 item\(ns\) persistido\(s\) não foram publicados/);
  });
});

describe("buildAssetReportHtml — payload de parecer em formato antigo (v1) nunca é renderizado", () => {
  const asset = ativoMinaSintetico({
    iaRelatorioConsolidado: {
      parecer: "Parecer sintético em prosa antiga.",
      pontosFortes: ["Cobertura SIGEF presente"],
      riscos: ["Risco antigo de prosa livre"],
      geradoEm: "2026-08-01T00:00:00Z",
      insumosHash: "hash-antigo-qualquer",
    },
  });
  const html = buildAssetReportHtml(asset);

  test("prosa antiga não aparece; aviso de regeração aparece no lugar", () => {
    assert.ok(!html.includes("Parecer sintético em prosa antiga"));
    assert.ok(!html.includes("Risco antigo de prosa livre"));
    assert.match(html, /formato antigo/);
    assert.match(html, /será regerado no novo formato/);
  });
});

describe("buildAssetReportHtml — composição decisória, anexos e privacidade", () => {
  test("ordena o corpo por decisão e move as evidências brutas para depois", () => {
    const html = buildAssetReportHtml(ativoMinaSintetico());
    const titulos = [
      "1. Identificação e maturidade do ativo",
      "2. Parecer Consolidado (disciplina de certeza)",
      "3. Situação processual e alertas de prazo",
      "4. Contraparte: histórico, sanções e capacidade",
      "5. Fundiário e socioambiental",
      "6. Evidências da jazida: síntese, impeditivos e lacunas",
      "7. Infraestrutura e contexto mineral",
      "8. Riscos priorizados e encaminhamentos",
      "9. Fontes, cobertura temporal e limitações",
      "Anexos e evidências brutas",
    ];
    let anterior = -1;
    for (const titulo of titulos) {
      const atual = html.indexOf(titulo);
      assert.ok(atual > anterior, `seção fora de ordem ou ausente: ${titulo}`);
      anterior = atual;
    }
  });

  test("todos os seis campos críticos aparecem, inclusive como AUSENTE e lacuna de quatro campos", () => {
    const html = buildAssetReportHtml(ativoMinaSintetico());
    for (const campo of [
      "Teor da substância", "Recurso e categoria", "Densidade",
      "Relatório Final de Pesquisa", "Licenciamento ambiental", "Produção histórica (CFEM)",
    ]) assert.ok(html.includes(campo), `campo crítico ausente: ${campo}`);
    assert.match(html, /AUSENTE/);
    for (const coluna of ["O que falta", "Por que importa", "Onde obter", "Custo e prazo"]) {
      assert.ok(html.includes(coluna), `coluna de lacuna ausente: ${coluna}`);
    }
    assert.match(html, /Não é possível concluir sobre/);
  });

  test("CPF, telefone e e-mail ficam fora do corpo e do digest, mas entram no anexo restrito", () => {
    const asset = ativoMinaSintetico();
    asset.__scmData.titularCpf = "123.456.789-01";
    asset.camposEspecificos.anmTitular = { titular: {} };
    asset.camposEspecificos.anmTitular.titular.cpf = "123.456.789-01";
    asset.camposEspecificos.anmTitular.titular.telefone = "(31) 99999-0000";
    asset.camposEspecificos.anmTitular.titular.email = "pf@example.com";
    const html = buildAssetReportHtml(asset);
    const corpo = html.slice(0, html.indexOf('<div class="annex-break">'));
    for (const pessoal of ["123.456.789-01", "(31) 99999-0000", "pf@example.com"]) {
      assert.ok(!corpo.includes(pessoal), `dado pessoal vazou no corpo: ${pessoal}`);
      assert.ok(!buildAssetDigest(asset).includes(pessoal), `dado pessoal vazou no digest: ${pessoal}`);
      assert.ok(html.includes(pessoal), `dado pessoal não foi preservado no bloco restrito: ${pessoal}`);
    }
    assert.match(html, /Anexo restrito — dados pessoais/);
    assert.match(html, /LGPD, art. 7º, V e VI/);
  });

  test("narrativas antigas de IA não reaparecem no corpo e são deduplicadas como hipótese T4", () => {
    const texto = "Preço justo dependeria de confirmação documental.";
    const asset = ativoMinaSintetico({
      iaAnalise: texto,
      iaPricing: texto,
      iaEnrichment: { resumoExecutivo: texto },
    });
    const html = buildAssetReportHtml(asset);
    const corpo = html.slice(0, html.indexOf('<div class="annex-break">'));
    assert.ok(!corpo.includes(texto));
    assert.equal((html.match(/Preço justo dependeria de confirmação documental/g) || []).length, 1);
    assert.match(html, /Hipóteses legadas \(T4, não verificadas\)/);
    assert.match(html, /Se for confirmado em fonte T1\/T2/);
  });

  test("certidões com CNPJ não confirmado não viram sinal favorável ou desfavorável no corpo", () => {
    const asset = ativoMinaSintetico({
      anmCertidoesTitular: {
        disponivel: true,
        cnpj: "12345678000199",
        vinculoConfirmadoPorDocumento: false,
        avisoVinculo: "CNPJ resolvido por nome — vinculação não confirmada por documento",
        consultadoEm: "2026-08-19T00:00:00Z",
        pgfn: { temDebitoAtivo: true, situacao: "DÍVIDA TESTE NÃO ATRIBUIR" },
        ceis: { sancionado: true, sancoes: [{ id: 1 }] },
        cnj: null,
      },
    });
    const html = buildAssetReportHtml(asset);
    const corpo = html.slice(0, html.indexOf('<div class="annex-break">'));
    assert.ok(!corpo.includes("DÍVIDA TESTE NÃO ATRIBUIR"));
    assert.ok(!corpo.includes("CEIS: sanção(ões) vigente(s)"));
    assert.match(corpo, /Não é possível atribuir os resultados/);
    assert.match(corpo, /vinculação não confirmada por documento/);
  });

  test("fontes brutas de terreno, ambiental, Embrapa e SICOR permanecem nos anexos", () => {
    const asset = ativoMinaSintetico({
      ambiental: { deterStatus: "SEM ALERTAS TESTE", consultadoEm: "2026-08-19T00:00:00Z" },
      embrapa: { solo: "LATOSSOLO TESTE" },
      sicorData: { totalValor: 12345, totalContratos: 2 },
    });
    asset.geoAltMed = 777;
    asset.geoAnalyzedAt = "2026-08-19T00:00:00Z";
    const html = buildAssetReportHtml(asset);
    const anexo = html.slice(html.indexOf('<div class="annex-break">'));
    for (const esperado of ["Georreferenciamento e Terreno", "SEM ALERTAS TESTE", "LATOSSOLO TESTE", "Crédito Rural na Região"]) {
      assert.ok(anexo.includes(esperado), `evidência bruta ausente do anexo: ${esperado}`);
    }
  });

  test("endereço embutido em texto livre T3 é redigido no anexo comum e preservado no restrito", () => {
    const endereco = "Rua das Flores, 123, Belo Horizonte";
    const asset = ativoMinaSintetico({
      iaDeepIntel: { resumoInvestigacao: `Contato localizado em ${endereco}. Confirmar em fonte oficial.` },
    });
    const html = buildAssetReportHtml(asset);
    const inicioRestrito = html.indexOf('<section class="restricted">');
    const anexoComum = html.slice(html.indexOf('<div class="annex-break">'), inicioRestrito);
    const restrito = html.slice(inicioRestrito);
    assert.ok(!anexoComum.includes(endereco), "endereço de PF vazou no anexo T3 comum");
    assert.match(anexoComum, /\[endereço no anexo restrito\]/);
    assert.ok(restrito.includes(endereco), "endereço original não foi consolidado no bloco restrito");
  });

  test("processos localizados apenas por nome não aparecem como registros no corpo", () => {
    const asset = ativoMinaSintetico({
      anmTitular: {
        titular: { nome: "MINERADORA SINTETICA LTDA" },
        consultadoEm: "2026-08-19T00:00:00Z",
        outrosProcessos: [{ PROCESSO: "999999/2025", NOME: "MINERADORA SINTETICA LTDA", FASE: "LAVRA", SUBS: "OURO", UF: "MG" }],
      },
    });
    const html = buildAssetReportHtml(asset);
    const corpo = html.slice(0, html.indexOf('<div class="annex-break">'));
    const anexos = html.slice(html.indexOf('<div class="annex-break">'));
    assert.ok(!corpo.includes("999999/2025"));
    assert.match(corpo, /excluídos do corpo e movidos ao anexo T3/);
    assert.ok(anexos.includes("999999/2025"));
    assert.match(anexos, /Processos com nome de titular coincidente \(não verificados\)/);
  });

  test("situação processual cita datas reais e não escolhe entre fontes conflitantes", () => {
    const asset = ativoMinaSintetico({
      anmLiveDataUpdatedAt: "2026-08-19T00:00:00Z",
      anmLiveData: { features: [{ attributes: { FASE: "CONCESSÃO DE LAVRA", UF: "MG", AREA_HA: 49.2 } }] },
    });
    const html = buildAssetReportHtml(asset);
    const inicio = html.indexOf("3. Situação processual e alertas de prazo");
    const fim = html.indexOf("4. Contraparte:", inicio);
    const secao = html.slice(inicio, fim);
    assert.match(secao, /A VERIFICAR — CONFLITO ENTRE FONTES/);
    assert.match(secao, /CONCESSÃO DE LAVRA/);
    assert.match(secao, /REQUERIMENTO DE LAVRA/);
    assert.match(secao, /\[SIGMINE\/ANM, 19\/08\/2026\]/);
    assert.match(secao, /\[SCM\/ANM, 10\/08\/2026\]/);
    assert.ok(!secao.includes("data não informada"));
  });
});

// escape mínimo igual ao do relatório, para comparar labels com acentos/&
function esc6(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

describe("formatSobreposicao — sanidade numérica na exibição", () => {
  test("marcador aVerificar substitui os números", () => {
    assert.equal(
      formatSobreposicao(10, 5, "interseção excede a área da parcela"),
      "a verificar — interseção excede a área da parcela",
    );
  });
  test("guarda para dados legados: pct > 100 nunca é exibido", () => {
    assert.match(formatSobreposicao(10, 140), /^a verificar/);
  });
  test("valores negativos nunca são exibidos", () => {
    assert.match(formatSobreposicao(-5, 10), /^a verificar/);
    assert.match(formatSobreposicao(5, -1), /^a verificar/);
  });
  test("100% exato continua válido (tolerância só acima de 100,5)", () => {
    assert.equal(formatSobreposicao(1955.42, 100), "1.955,42 ha (100% do polígono)");
  });
});

describe("avaliarDisponibilidadeModulos — meta do contrato de três estados", () => {
  test("payload ausente → meta nao_consultada com tier do módulo", () => {
    const mods = avaliarDisponibilidadeModulos({});
    const dou = mods.find((m) => m.key === "anmDou")!;
    assert.equal(dou.meta!.estadoConsulta, "nao_consultada");
    assert.equal(dou.meta!.tierFonte, "T2");
    const tah = mods.find((m) => m.key === "anmTah")!;
    assert.equal(tah.meta!.tierFonte, "T1");
  });
  test("payload novo com contrato explícito é respeitado", () => {
    const mods = avaliarDisponibilidadeModulos({
      anmDou: {
        disponivel: true,
        estadoConsulta: "consultada_sem_registro",
        tierFonte: "T2",
        consultadoEm: "2026-08-18T00:00:00Z",
        janelaCobertura: "edições do DOU desde 2002",
      },
    });
    const dou = mods.find((m) => m.key === "anmDou")!;
    assert.equal(dou.meta!.estadoConsulta, "consultada_sem_registro");
    assert.equal(dou.meta!.janelaCobertura, "edições do DOU desde 2002");
  });
  test("Querido Diário (anmDouMunicipal) aparece na telemetria de módulos", () => {
    const mods = avaliarDisponibilidadeModulos({});
    assert.ok(mods.some((m) => m.key === "anmDouMunicipal"));
  });
});
