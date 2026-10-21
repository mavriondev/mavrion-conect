// Contrato de três estados nas ROTAS dos módulos do relatório:
// (a) estados normais do TAH (registro existente / sem registro / base vazia);
// (b) falha operacional em qualquer rota devolve o contrato completo — nunca
//     um payload nu {disponivel:false,message}.
// O pool do Postgres é encerrado no último bloco para forçar os catches REAIS
// das rotas (getCached/getTahByProcesso/getSigbmStats/getCfemStats lançam).
// Rodar com: npx tsx --test server/lib/__tests__/contrato-falhas-rotas.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../db";
import { assets, organizations, sigbmBarragens, tahTitulares } from "@shared/schema";
import { registerDossieRoutes } from "../../routes/dossie";
import { registerTahRoutes } from "../../routes/tah";
import { registerAssetRoutes } from "../../routes/assets";
import { storage } from "../../storage";
import { payloadFalhaConsulta, montarIdentificadorCnpj } from "../consulta-contrato";

let server: Server | undefined;
let baseUrl = "";
let stubOrgId = 1;

before(async () => {
  const app = express();
  // stub de autenticação: as rotas exigem req.isAuthenticated()
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: 1, orgId: stubOrgId, role: "admin" };
    next();
  });
  registerDossieRoutes(app);
  registerTahRoutes(app);
  registerAssetRoutes(app, storage, db as any);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

after(() => { server?.close(); });

const get = async (path: string) => {
  const resp = await fetch(`${baseUrl}${path}`);
  return { status: resp.status, body: (await resp.json()) as any };
};

const post = async (path: string) => {
  const resp = await fetch(`${baseUrl}${path}`, { method: "POST" });
  return { status: resp.status, body: (await resp.json()) as any };
};

const contratoFalha = (b: any) => {
  assert.equal(b.disponivel, false);
  assert.equal(b.estadoConsulta, "nao_consultada");
  assert.ok("situacaoRegistro" in b, "situacaoRegistro ausente");
  assert.equal(b.situacaoRegistro, null);
  assert.ok(["T1", "T2", "T3"].includes(b.tierFonte), `tierFonte ausente/inválido: ${b.tierFonte}`);
  assert.ok(typeof b.consultadoEm === "string" && b.consultadoEm.length > 0, "consultadoEm ausente");
  assert.ok(typeof b.motivoFalha === "string" && b.motivoFalha.length > 0, "motivoFalha ausente");
  assert.ok(typeof b.fonte === "string" && b.fonte.length > 0, "fonte ausente");
  assert.ok("janelaCobertura" in b, "janelaCobertura ausente");
  assert.ok("identificadorVinculo" in b, "identificadorVinculo ausente");
};

describe("payloadFalhaConsulta — builder central de falha", () => {
  test("carrega estado, tier, data, janela, identificador/proveniência e motivo", () => {
    const p: any = payloadFalhaConsulta({
      fonte: "Fonte X",
      tierFonte: "T2",
      motivoFalha: "caiu",
      identificadorVinculo: montarIdentificadorCnpj("12345678000195", "cnpja_auto"),
      extras: { municipio: "Teste" },
    });
    contratoFalha(p);
    assert.equal(p.tierFonte, "T2");
    assert.equal(p.identificadorVinculo.proveniencia, "resolvido_por_nome");
    assert.equal(p.message, "caiu"); // compat com consumidores que exibem message
    assert.equal(p.municipio, "Teste");
  });
});

describe("TAH — contrato nos estados normais (banco vivo)", () => {
  test("processo inexistente → 404 com contrato completo (sem-registro ou base vazia)", async () => {
    const { status, body } = await get("/api/tah/processo/999999%2F1900");
    assert.equal(status, 404);
    // base populada = consultada_sem_registro; base vazia = nao_consultada
    assert.ok(["consultada_sem_registro", "nao_consultada"].includes(body.estadoConsulta), `estado inesperado: ${body.estadoConsulta}`);
    assert.equal(body.tierFonte, "T1");
    assert.ok(typeof body.fonte === "string" && body.fonte.length > 0, "fonte ausente no 404");
    assert.ok(body.consultadoEm, "consultadoEm ausente no 404");
    assert.ok("janelaCobertura" in body, "janelaCobertura ausente no 404");
    assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
    assert.equal(body.identificadorVinculo?.proveniencia, "documento_oficial");
    if (body.estadoConsulta === "consultada_sem_registro") {
      assert.equal(body.disponivel, true); // consulta completou — ausência é resultado, não falha
    } else {
      assert.ok(typeof body.motivoFalha === "string" && body.motivoFalha.length > 0);
    }
  });

  test("registro existente → 200 com contrato completo", async () => {
    // a base dev pode estar vazia: semeia um registro sintético e remove no fim
    const PROC = "999888";
    const ANO = 2024;
    const limpar = () => db.delete(tahTitulares)
      .where(and(eq(tahTitulares.processo, PROC), eq(tahTitulares.anoBase, ANO)));
    await limpar();
    await db.insert(tahTitulares).values({
      processo: PROC, anoBase: ANO, cnpjCpf: "12345678000195",
      nomeTitular: "Mineradora Teste Contrato Ltda", tipoPessoa: "PJ",
      fase: "AUTORIZAÇÃO DE PESQUISA", uf: "MG", areaHa: 100,
      valorCobrado: 1000, valorPago: 1000,
    });
    try {
      const { status, body } = await get(`/api/tah/processo/${PROC}%2F${ANO}`);
      assert.equal(status, 200);
      assert.equal(body.estadoConsulta, "registro_existente");
      assert.equal(body.tierFonte, "T1"); // casado por processo+ano → sem rebaixamento
      assert.equal(body.vinculoConfirmado, true);
      assert.ok(typeof body.fonte === "string" && body.fonte.length > 0, "fonte ausente no sucesso");
      assert.ok(body.consultadoEm);
      assert.ok(typeof body.janelaCobertura === "string" && body.janelaCobertura.length > 0, "janelaCobertura ausente no sucesso");
      assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
      assert.equal(body.identificadorVinculo?.proveniencia, "documento_oficial");
      assert.equal(body.registros?.length, 1);
    } finally {
      await limpar();
    }
  });
});

describe("módulos — contrato comum no nível do módulo (sucesso, vazio e falha de fornecedor)", () => {
  const realFetch = globalThis.fetch;
  const mockFetch = (handler: (url: string) => { status?: number; json?: any } | Error) => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input?.url ?? input);
      // as requisições HTTP dos próprios testes passam direto
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
        return (realFetch as any)(input, init);
      }
      const r = handler(url);
      if (r instanceof Error) throw r;
      return {
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        json: async () => r.json ?? {},
        text: async () => JSON.stringify(r.json ?? {}),
        headers: new Headers({ "content-type": "application/json" }),
      } as any;
    }) as any;
  };
  const restoreFetch = () => { globalThis.fetch = realFetch; };

  test("DOU — parâmetros ausentes devolvem o contrato completo de falha", async () => {
    const { consultarDou } = await import("../dou");
    const r: any = await consultarDou({});
    contratoFalha(r);
    assert.equal(r.tierFonte, "T2");
    assert.equal(r.identificadorVinculo, null);
    assert.deepEqual(r.termosBuscados, []);
  });

  test("Querido Diário — sem termos e sem município devolvem o contrato completo", async () => {
    const { consultarQueridoDiario } = await import("../querido-diario");
    const semTermos: any = await consultarQueridoDiario({ municipio: "Paracatu" });
    contratoFalha(semTermos);
    assert.equal(semTermos.identificadorVinculo, null);
    const semMunicipio: any = await consultarQueridoDiario({ processo: "832.070/2024", titular: "Empresa Teste Ltda", municipio: "" });
    contratoFalha(semMunicipio);
    assert.equal(semMunicipio.identificadorVinculo?.tipo, "processo_anm");
    assert.equal(semMunicipio.identificadorVinculo?.proveniencia, "documento_oficial");
    assert.equal(semMunicipio.termosBuscados.length, 3);
  });

  test("Certidões — registro no CEIS → módulo registro_existente com contrato completo", async () => {
    const { consultarCertidoes } = await import("../certidoes");
    mockFetch((url) => url.includes("datajud")
      ? { json: {} }
      : { json: [{ descricaoResumida: "sanção vigente de teste" }] });
    try {
      const r: any = await consultarCertidoes("12.345.678/0001-95", { tipo: "cnpj", valor: "12345678000195", proveniencia: "documento_oficial", origem: "SCM" });
      assert.equal(r.estadoConsulta, "registro_existente");
      assert.equal(r.situacaoRegistro, "aberta");
      assert.equal(r.tierFonte, "T1");
      assert.ok(typeof r.consultadoEm === "string" && r.consultadoEm.length > 0);
      assert.ok("janelaCobertura" in r, "janelaCobertura ausente no módulo certidões");
      assert.equal(r.estados.ceis.estadoConsulta, "registro_existente");
      assert.equal(r.identificadorVinculo?.proveniencia, "documento_oficial");
      assert.equal(r.vinculoConfirmadoPorDocumento, true);
    } finally { restoreFetch(); }
  });

  test("Certidões — CEIS falhou → módulo nao_consultada (nunca 'sem registro')", async () => {
    const { consultarCertidoes } = await import("../certidoes");
    mockFetch((url) => url.includes("datajud") ? { json: {} } : { status: 500 });
    try {
      const r: any = await consultarCertidoes("12.345.678/0001-95", null);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.equal(r.situacaoRegistro, null);
      assert.ok(typeof r.motivoEstado === "string" && r.motivoEstado.length > 0, "motivoEstado ausente");
      assert.equal(r.estados.ceis.estadoConsulta, "nao_consultada");
      assert.ok(r.consultadoEm);
    } finally { restoreFetch(); }
  });

  test("SIGBM — sucesso carrega identificador/proveniência e confirmação coerentes", async () => {
    const { consultarBarragens } = await import("../sigbm-importer");
    const limpar = () => db.delete(sigbmBarragens).where(eq(sigbmBarragens.idAnm, 99999901));
    await limpar();
    await db.insert(sigbmBarragens).values({
      idAnm: 99999901, nome: "Barragem Teste Contrato",
      empreendedor: "MINERADORA CONTRATO SIGBM LTDA", cpfCnpj: "99988877000166",
      uf: "MG", municipio: "Teste",
    } as any);
    try {
      // casada por CNPJ → vínculo confirmado, T1
      const porCnpj: any = await consultarBarragens({ cnpj: "99.988.877/0001-66" });
      assert.equal(porCnpj.estadoConsulta, "registro_existente");
      assert.equal(porCnpj.tierFonte, "T1");
      assert.equal(porCnpj.identificadorVinculo?.tipo, "cnpj");
      assert.equal(porCnpj.vinculoConfirmado, true);
      assert.ok(porCnpj.fonte && porCnpj.consultadoEm);
      assert.ok("janelaCobertura" in porCnpj);
      // casada só por nome (LIKE) → não confirmada, rebaixada, não vira registro do titular
      const porNome: any = await consultarBarragens({ nomeTitular: "MINERADORA CONTRATO SIGBM" });
      assert.equal(porNome.estadoConsulta, "consultada_sem_registro");
      assert.equal(porNome.tierFonte, "T3");
      assert.equal(porNome.tierFonteOriginal, "T1");
      assert.equal(porNome.identificadorVinculo?.tipo, "nome");
      assert.equal(porNome.vinculoConfirmado, false);
      assert.equal(porNome.doTitular.length, 1);
      // nada casou → sem registro, identificador registra o que foi buscado
      const semMatch: any = await consultarBarragens({ cnpj: "00.000.000/0001-91" });
      assert.equal(semMatch.estadoConsulta, "consultada_sem_registro");
      assert.equal(semMatch.identificadorVinculo?.tipo, "cnpj");
      assert.equal(semMatch.vinculoConfirmado, null);
    } finally { await limpar(); }
  });

  test("Restrições — todas as camadas falham → módulo nao_consultada com contrato", async () => {
    const { consultarRestricoesCruzamento } = await import("../restricoes-cruzamento");
    mockFetch(() => new Error("rede indisponível (teste)"));
    try {
      const r: any = await consultarRestricoesCruzamento(-19.9, -43.9, 10);
      assert.equal(r.disponivel, true);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.ok(typeof r.motivoEstado === "string" && r.motivoEstado.length > 0, "motivoEstado ausente");
      assert.equal(r.tierFonte, "T1");
      assert.equal(r.identificadorVinculo?.tipo, "geometria");
      assert.ok("janelaCobertura" in r);
      assert.ok(r.consultadoEm);
      assert.equal(r.naoConsultadas, 5);
    } finally { restoreFetch(); }
  });

  const orgDeTeste = async () => {
    const existente = (await db.select({ id: organizations.id }).from(organizations).limit(1))[0]?.id;
    if (existente) return existente;
    return (await db.insert(organizations).values({ name: "Org Teste Contrato" }).returning({ id: organizations.id }))[0].id;
  };
  const RINGS_SIGMINE = { json: { features: [{ geometry: { rings: [[[-44, -20], [-44, -19.99], [-43.99, -19.99], [-43.99, -20], [-44, -20]]] } }] } };

  test("Rotas SIGEF/CAR — fornecedor indisponível → 502 com contrato completo e falha persistida", async () => {
    stubOrgId = await orgDeTeste();
    const orgId = stubOrgId;
    const [{ id: assetId }] = await db.insert(assets).values({
      orgId, type: "MINA", title: "Ativo Teste Contrato SIGEF/CAR",
      anmProcesso: "999.777/2024", estado: "MG",
    } as any).returning({ id: assets.id });
    // SIGMINE (geometria do processo) responde; espelho SIGEF e GeoServer SICAR caem
    mockFetch((url) => url.includes("geo.anm.gov.br") ? RINGS_SIGMINE : new Error("fonte externa indisponível (teste)"));
    try {
      const sigef = await post(`/api/assets/${assetId}/sigef-parcelas`);
      assert.equal(sigef.status, 502);
      contratoFalha(sigef.body);
      assert.equal(sigef.body.tierFonte, "T1");
      assert.equal(sigef.body.identificadorVinculo?.tipo, "geometria");
      assert.ok(sigef.body.fonte.includes("SIGEF"), `fonte inesperada: ${sigef.body.fonte}`);

      const car = await post(`/api/assets/${assetId}/car-imoveis`);
      assert.equal(car.status, 502);
      contratoFalha(car.body);
      assert.equal(car.body.identificadorVinculo?.tipo, "geometria");
      assert.ok(car.body.fonte.includes("SICAR"), `fonte inesperada: ${car.body.fonte}`);

      // a falha fica persistida no ativo — telemetria/PDF distinguem
      // "consulta falhou em X" de "fonte nunca acionada"
      const [row] = await db.select({ campos: assets.camposEspecificos }).from(assets).where(eq(assets.id, assetId));
      const campos: any = row?.campos || {};
      assert.equal(campos.sigefParcelas?.disponivel, false);
      assert.equal(campos.sigefParcelas?.estadoConsulta, "nao_consultada");
      assert.ok(campos.sigefParcelas?.motivoFalha, "motivoFalha não persistido (SIGEF)");
      assert.equal(campos.carImoveis?.disponivel, false);
      assert.equal(campos.carImoveis?.estadoConsulta, "nao_consultada");
      assert.ok(campos.carImoveis?.motivoFalha, "motivoFalha não persistido (CAR)");
    } finally {
      restoreFetch();
      await db.delete(assets).where(eq(assets.id, assetId));
      stubOrgId = 1;
    }
  });

  test("Rotas SIGEF/CAR/CCIR — pré-condição ausente → 422 com contrato completo", async () => {
    stubOrgId = await orgDeTeste();
    const orgId = stubOrgId;
    // sem processo ANM → geometria irresolvível (sem rede); sem UF → 422 de UF no CAR
    const [{ id: semGeoId }] = await db.insert(assets).values({
      orgId, type: "MINA", title: "Ativo Teste Contrato sem geometria", estado: "MG",
    } as any).returning({ id: assets.id });
    const [{ id: semUfId }] = await db.insert(assets).values({
      orgId, type: "MINA", title: "Ativo Teste Contrato sem UF", anmProcesso: "999.778/2024",
    } as any).returning({ id: assets.id });
    mockFetch((url) => url.includes("geo.anm.gov.br") ? RINGS_SIGMINE : new Error("fonte externa indisponível (teste)"));
    try {
      const sigef = await post(`/api/assets/${semGeoId}/sigef-parcelas`);
      assert.equal(sigef.status, 422);
      contratoFalha(sigef.body);
      assert.ok(sigef.body.fonte.includes("SIGEF"));

      const carSemGeo = await post(`/api/assets/${semGeoId}/car-imoveis`);
      assert.equal(carSemGeo.status, 422);
      contratoFalha(carSemGeo.body);
      assert.ok(carSemGeo.body.fonte.includes("SICAR"));

      const carSemUf = await post(`/api/assets/${semUfId}/car-imoveis`);
      assert.equal(carSemUf.status, 422);
      contratoFalha(carSemUf.body);
      assert.ok(/UF/.test(carSemUf.body.motivoFalha), `motivo inesperado: ${carSemUf.body.motivoFalha}`);
      assert.equal(carSemUf.body.identificadorVinculo?.tipo, "geometria");

      const ccir = await post(`/api/enrichment/ccir/${semGeoId}`);
      assert.equal(ccir.status, 422);
      contratoFalha(ccir.body);
      assert.ok(ccir.body.fonte.includes("CCIR"));
    } finally {
      restoreFetch();
      await db.delete(assets).where(eq(assets.id, semGeoId));
      await db.delete(assets).where(eq(assets.id, semUfId));
      stubOrgId = 1;
    }
  });

  test("CCIR mineral — consolidação devolve e persiste o contrato completo", async () => {
    stubOrgId = await orgDeTeste();
    const orgId = stubOrgId;
    const [{ id: assetId }] = await db.insert(assets).values({
      orgId, type: "MINA", title: "Ativo Teste Contrato CCIR", anmProcesso: "999.779/2024", estado: "MG",
      camposEspecificos: {
        sigefParcelas: {
          disponivel: true, janelaCobertura: "espelho SIGEF data-base teste",
          parcelas: [{ codigoParcela: "PARC-1", relacao: "sobreposta", detentor: "Detentor Teste", nomeArea: "Fazenda Teste", areaHa: 100 }],
        },
        carImoveis: {
          disponivel: true, janelaCobertura: "CAR vigente teste",
          imoveis: [{ codImovel: "CAR-1", relacao: "sobreposto", municipio: "Teste", areaHa: 90 }],
        },
      },
    } as any).returning({ id: assets.id });
    mockFetch((url) => url.includes("geo.anm.gov.br") ? RINGS_SIGMINE : new Error("fonte externa indisponível (teste)"));
    try {
      const { status, body } = await post(`/api/enrichment/ccir/${assetId}`);
      assert.equal(status, 200, `esperava 200, veio ${status}: ${JSON.stringify(body).slice(0, 300)}`);
      const cc = body.ccirImoveis;
      assert.equal(cc.disponivel, true);
      assert.equal(cc.estadoConsulta, "registro_existente");
      assert.equal(cc.tierFonte, "T1");
      assert.ok(typeof cc.janelaCobertura === "string" && cc.janelaCobertura.length > 0, "janelaCobertura ausente");
      assert.equal(cc.identificadorVinculo?.tipo, "geometria");
      assert.equal(cc.identificadorVinculo?.proveniencia, "documento_oficial");
      // disponibilidade do SNCR e do casamento SIGEF×CAR explícitas (não engolidas)
      assert.ok(["registro_existente", "consultada_sem_registro", "nao_consultada"].includes(cc.estadoSncr), `estadoSncr: ${cc.estadoSncr}`);
      if (cc.estadoSncr === "nao_consultada") assert.ok(cc.motivoEstadoSncr, "motivoEstadoSncr ausente");
      assert.ok(typeof cc.casamentoRealizado === "boolean", "casamentoRealizado ausente");
      if (!cc.casamentoRealizado) assert.ok(cc.casamentoIndisponivelMotivo, "casamentoIndisponivelMotivo ausente");
      assert.ok(cc.consultadoEm && cc.fonte);
      // persistido com o mesmo contrato
      const [row] = await db.select({ campos: assets.camposEspecificos }).from(assets).where(eq(assets.id, assetId));
      assert.equal((row?.campos as any)?.ccirImoveis?.estadoConsulta, "registro_existente");
      assert.equal((row?.campos as any)?.ccirImoveis?.situacaoRegistro, "indeterminada");
      assert.equal((row?.campos as any)?.ccirImoveis?.tierFonte, "T1");
    } finally {
      restoreFetch();
      await db.delete(assets).where(eq(assets.id, assetId));
      stubOrgId = 1;
    }
  });
});

describe("rotas — pré-condição ausente (400) devolve contrato completo", () => {
  test("CFEM/SIGBM/DOU/QD/certidões/TAH — validação de entrada com contrato", async () => {
    const casos: Array<{ path: string; fonteFrag: string }> = [
      { path: "/api/cfem/dossie", fonteFrag: "CFEM" },
      { path: "/api/sigbm/barragens", fonteFrag: "SIGBM" },
      { path: "/api/dou/publicacoes", fonteFrag: "Diário Oficial" },
      { path: "/api/dou/municipal", fonteFrag: "Querido Diário" },
      { path: "/api/dossie/certidoes-titular?cnpj=123", fonteFrag: "Certidões" },
      // 14 dígitos repetidos e dígito verificador errado também são pré-condição inválida
      { path: "/api/dossie/certidoes-titular?cnpj=11111111111111", fonteFrag: "Certidões" },
      { path: "/api/dossie/certidoes-titular?cnpj=11222333000182", fonteFrag: "Certidões" },
      { path: "/api/tah/processo/abc", fonteFrag: "TAH" },
    ];
    for (const { path, fonteFrag } of casos) {
      const { status, body } = await get(path);
      assert.equal(status, 400, `esperava 400 em ${path}`);
      contratoFalha(body);
      assert.ok(body.fonte.includes(fonteFrag), `fonte inesperada em ${path}: ${body.fonte}`);
      assert.ok(body.message, `message (compat) ausente em ${path}`);
    }
  });

  test("DOU municipal — sem município preserva o identificador do processo informado", async () => {
    const { status, body } = await get("/api/dou/municipal?processo=832.070%2F2024&titular=Empresa+Teste");
    assert.equal(status, 400);
    contratoFalha(body);
    assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
    assert.equal(body.identificadorVinculo?.proveniencia, "documento_oficial");
  });
});

describe("rotas de módulos do relatório — catch devolve contrato completo", () => {
  test("SIGEF/CAR (assets) — erro interno → 500 com contrato completo", async () => {
    for (const path of ["/api/assets/999999/sigef-parcelas", "/api/assets/999999/car-imoveis", "/api/enrichment/ccir/999999"]) {
      const { status, body } = await post(path);
      assert.equal(status, 500, `esperava 500 em ${path}`);
      contratoFalha(body);
      assert.equal(body.tierFonte, "T1");
    }
  });

  before(async () => {
    // derruba o pool: toda consulta ao Postgres passa a lançar, forçando os
    // catches reais das rotas (não há como "esquecer" o contrato na falha)
    await pool.end();
  });

  test("TAH /api/tah/processo — erro inesperado responde 500 COM contrato", async () => {
    const { status, body } = await get("/api/tah/processo/832070%2F2024");
    assert.equal(status, 500);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T1");
    assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
    assert.match(body.motivoFalha, /TAH/);
  });

  test("DOU /api/dou/publicacoes — catch da rota devolve contrato", async () => {
    const { status, body } = await get("/api/dou/publicacoes?processo=832.070/2024");
    assert.equal(status, 200);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T2");
    assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
  });

  test("Querido Diário /api/dou/municipal — catch da rota devolve contrato", async () => {
    const { status, body } = await get("/api/dou/municipal?processo=832.070/2024&municipio=Paracatu&uf=MG");
    assert.equal(status, 200);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T2");
    assert.equal(body.municipio, "Paracatu");
  });

  test("Certidões /api/dossie/certidoes-titular — catch da rota devolve contrato", async () => {
    const { status, body } = await get("/api/dossie/certidoes-titular?cnpj=12345678000195");
    assert.equal(status, 200);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T1");
    assert.equal(body.identificadorVinculo?.tipo, "cnpj");
  });

  test("SIGBM /api/sigbm/barragens — falha devolve contrato", async () => {
    const { status, body } = await get("/api/sigbm/barragens?cnpj=12345678000195");
    assert.equal(status, 200);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T1");
    assert.equal(body.identificadorVinculo?.tipo, "cnpj");
  });

  test("CFEM /api/cfem/dossie — erro inesperado responde 500 COM contrato", async () => {
    const { status, body } = await get("/api/cfem/dossie?processo=832.070/2024");
    assert.equal(status, 500);
    contratoFalha(body);
    assert.equal(body.tierFonte, "T1");
    assert.equal(body.identificadorVinculo?.tipo, "processo_anm");
    assert.match(body.motivoFalha, /CFEM/);
  });
});
