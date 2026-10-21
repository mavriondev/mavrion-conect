// Falhas parciais e totais nas buscas de DOU e Querido Diário: cobertura
// incompleta da busca por NÚMERO do processo nunca pode virar "consultada sem
// registro", e todo caminho de falha devolve o contrato de três estados.
// Rodar com: npx tsx --test server/lib/__tests__/diarios-falha-parcial.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { consultarDou } from "../dou";
import { consultarQueridoDiario } from "../querido-diario";

const realFetch = globalThis.fetch;
function mockFetch(handler: (url: string) => { status: number; body?: string } | null) {
  globalThis.fetch = (async (input: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    const r = handler(url);
    if (!r) throw new Error(`fetch não mockado para ${url}`);
    return new Response(r.body ?? "", { status: r.status });
  }) as any;
}
const restore = () => { globalThis.fetch = realFetch; };

// termo de busca embutido na URL (q= do DOU, querystring= do QD)
const termoDaUrl = (url: string, param: string) => {
  const raw = (url.match(new RegExp(`[?&]${param}=([^&]*)`)) || [])[1] || "";
  return decodeURIComponent(raw.replace(/\+/g, "%20"));
};

const douHtml = (jsonArray: any[]) =>
  `<html><body><script type="application/json" id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params">${JSON.stringify({ jsonArray })}</script></body></html>`;
const douItem = {
  title: "Portaria de Lavra", content: "Concessão de lavra outorgada", pubDate: "10/06/2026",
  pubName: "DO1", artType: "Portaria", hierarchyStr: "ANM", urlTitle: "portaria-x",
};

const PROCESSO = "832.070/2024"; // variantes: 832.070/2024 e 832070/2024
const TITULAR = "Mineradora Teste Ltda";

describe("DOU — falha parcial e total das buscas", () => {
  test("grafia do processo falhou + demais vazias → nao_consultada (nunca 'sem registro')", async () => {
    mockFetch((url) => {
      const q = termoDaUrl(url, "q");
      if (q.includes("832.070/2024")) return { status: 500 };
      if (q.includes("832070/2024")) return { status: 200, body: douHtml([]) };
      return { status: 200, body: douHtml([douItem]) }; // busca pelo nome do titular
    });
    try {
      const r: any = await consultarDou({ processo: PROCESSO, titular: TITULAR, refresh: true });
      assert.equal(r.disponivel, true);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.match(r.motivoEstado, /cobertura incompleta/);
      assert.deepEqual(r.termosComFalha, ["832.070/2024"]);
      // a publicação casada pelo nome continua exibível, mas não confirmada
      assert.equal(r.totalVinculoConfirmado, 0);
      assert.equal(r.totalVinculoNaoConfirmado, 1);
    } finally { restore(); }
  });

  test("registro confirmado por outra grafia prevalece mesmo com falha parcial", async () => {
    mockFetch((url) => {
      const q = termoDaUrl(url, "q");
      if (q.includes("832.070/2024")) return { status: 500 };
      if (q.includes("832070/2024")) return { status: 200, body: douHtml([douItem]) };
      return { status: 200, body: douHtml([]) };
    });
    try {
      const r: any = await consultarDou({ processo: PROCESSO, titular: TITULAR, refresh: true });
      assert.equal(r.estadoConsulta, "registro_existente");
      assert.equal(r.totalVinculoConfirmado, 1);
      assert.match(r.notaCobertura, /cobertura incompleta/);
      assert.equal(r.motivoEstado, undefined);
    } finally { restore(); }
  });

  test("só a busca pelo NOME falhou (grafias do processo completas e vazias) → consultada_sem_registro", async () => {
    mockFetch((url) => {
      const q = termoDaUrl(url, "q");
      if (q.includes("832.070/2024") || q.includes("832070/2024")) return { status: 200, body: douHtml([]) };
      return { status: 500 }; // nome do titular
    });
    try {
      const r: any = await consultarDou({ processo: PROCESSO, titular: TITULAR, refresh: true });
      assert.equal(r.estadoConsulta, "consultada_sem_registro");
      assert.deepEqual(r.termosComFalha, [TITULAR]);
      assert.match(r.notaCobertura, /cobertura incompleta/);
    } finally { restore(); }
  });

  test("falha total → contrato completo (estado, tier, identificador, motivo, consultadoEm)", async () => {
    mockFetch(() => ({ status: 500 }));
    try {
      const r: any = await consultarDou({ processo: PROCESSO, titular: TITULAR, refresh: true });
      assert.equal(r.disponivel, false);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.equal(r.tierFonte, "T2");
      assert.equal(r.termosBuscados.length, 3);
      assert.equal(r.termosComFalha.length, 3);
      assert.ok(r.consultadoEm);
      assert.ok(typeof r.motivoFalha === "string" && r.motivoFalha.length > 0);
      assert.ok(typeof r.fonte === "string" && r.fonte.length > 0);
      assert.ok("janelaCobertura" in r);
      assert.equal(r.identificadorVinculo?.tipo, "processo_anm");
      assert.equal(r.identificadorVinculo?.proveniencia, "documento_oficial");
    } finally { restore(); }
  });
});

describe("Querido Diário — falha parcial e total das buscas", () => {
  const municipioReal = async () => {
    const row: any = ((await db.execute(sql`SELECT nome, uf FROM ibge_municipios LIMIT 1`)) as any).rows?.[0];
    return row || null;
  };

  test("grafia do processo falhou + demais vazias → nao_consultada", async (t) => {
    const mun = await municipioReal();
    if (!mun) return t.skip("ibge_municipios vazia neste ambiente");
    mockFetch((url) => {
      if (url.includes("/cities/")) return { status: 200, body: JSON.stringify({ city: { level: "2" } }) };
      const q = termoDaUrl(url, "querystring");
      if (q.includes("832.070/2024")) return { status: 500 };
      return { status: 200, body: JSON.stringify({ gazettes: [] }) };
    });
    try {
      const r: any = await consultarQueridoDiario({ processo: PROCESSO, titular: TITULAR, municipio: mun.nome, uf: mun.uf, refresh: true });
      assert.equal(r.disponivel, true);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.match(r.motivoEstado, /cobertura incompleta/);
      assert.deepEqual(r.termosComFalha, ["832.070/2024"]);
    } finally { restore(); }
  });

  test("falha total das buscas → contrato completo com disponivel=false", async (t) => {
    const mun = await municipioReal();
    if (!mun) return t.skip("ibge_municipios vazia neste ambiente");
    mockFetch((url) => {
      if (url.includes("/cities/")) return { status: 200, body: JSON.stringify({ city: { level: "2" } }) };
      return { status: 500 };
    });
    try {
      const r: any = await consultarQueridoDiario({ processo: PROCESSO, titular: TITULAR, municipio: mun.nome, uf: mun.uf, refresh: true });
      assert.equal(r.disponivel, false);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.equal(r.tierFonte, "T2");
      assert.equal(r.termosBuscados.length, 3);
      assert.ok(r.consultadoEm);
      assert.ok(r.municipio);
      assert.ok(typeof r.motivoFalha === "string" && r.motivoFalha.length > 0);
      assert.ok(typeof r.fonte === "string" && r.fonte.length > 0);
      assert.ok("janelaCobertura" in r);
      assert.equal(r.identificadorVinculo?.tipo, "processo_anm");
      assert.equal(r.identificadorVinculo?.proveniencia, "documento_oficial");
    } finally { restore(); }
  });

  test("falha na checagem de cobertura → contrato completo (nao_consultada)", async (t) => {
    const mun = await municipioReal();
    if (!mun) return t.skip("ibge_municipios vazia neste ambiente");
    mockFetch((url) => {
      if (url.includes("/cities/")) return { status: 500 };
      return { status: 200, body: JSON.stringify({ gazettes: [] }) };
    });
    try {
      const r: any = await consultarQueridoDiario({ processo: PROCESSO, titular: TITULAR, municipio: mun.nome, uf: mun.uf, refresh: true });
      assert.equal(r.disponivel, false);
      assert.equal(r.estadoConsulta, "nao_consultada");
      assert.equal(r.tierFonte, "T2");
      assert.ok(r.consultadoEm);
      assert.ok(typeof r.motivoFalha === "string" && r.motivoFalha.length > 0);
      assert.equal(r.identificadorVinculo?.tipo, "processo_anm");
    } finally { restore(); }
  });
});
