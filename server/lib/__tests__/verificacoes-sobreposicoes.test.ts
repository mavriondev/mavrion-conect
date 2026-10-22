import assert from "node:assert/strict";
import { consultarSobreposicoes } from "../due-diligence-fundiaria";
import { verificarSobreposicoes, type AtivoGeo } from "../verificacoes-terra";
import { FONTES_RESTRICOES } from "../restricoes-wfs";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const ativo: AtivoGeo = {
  id: 1, lat: -18.60, lon: -46.10, carCodImovel: null,
  bbox: { minLon: -46.116, minLat: -18.611, maxLon: -46.059, maxLat: -18.556 },
  geojson: { type: "Polygon", coordinates: [[[-46.11, -18.60], [-46.10, -18.60], [-46.10, -18.59], [-46.11, -18.60]]] },
};
function mockFonte(opts: { falhaQuilombola?: boolean; positivas?: boolean } = {}) {
  globalThis.fetch = async input => {
    const u = new URL(String(input));
    if (u.searchParams.get("request") === "GetCapabilities") return new Response("<WFS_Capabilities/>");
    const camada = Object.values(FONTES_RESTRICOES).find(f => f.camada === u.searchParams.get("typeNames"));
    assert.ok(camada, "não consulta endpoints antigos");
    if (opts.falhaQuilombola && camada === FONTES_RESTRICOES.quilombola) return new Response("falha", { status: 503 });
    const features = opts.positivas ? [{
      type: "Feature", id: camada.camada + ".1", geometry: ativo.geojson,
      properties: {
        [camada.campoNome]: "Nome oficial", [camada.campoOrdenacao]: 1,
        ds_fase_ti: "Regularizada", status: "TITULADO", grupo: "Proteção Integral", categoria: "Parque Nacional",
      },
    }] : [];
    return new Response(JSON.stringify({ type: "FeatureCollection", features, numberMatched: features.length }));
  };
}
try {
  console.warn = () => {};
  mockFonte();
  const vazio = await verificarSobreposicoes(ativo, { usarCache: false });
  const tres = vazio.filter(v => v.chave !== "sobreposicao_assentamento");
  assert.equal(tres.length, 3);
  assert.ok(tres.every(v => v.estado === "indicado" && v.achado === "nao_detectado"));
  assert.ok(tres.every(v => v.observacao?.includes("não confirma ausência")));
  assert.match(tres.find(v => v.chave === "sobreposicao_quilombola")!.observacao!, /2022.*não é cadastro INCRA em tempo real/);
  assert.match(tres.find(v => v.chave === "sobreposicao_uc")!.fonte, /2026-07-31/);

  // Exercita o caminho real WFS -> camadas -> verificações, sem cache nem escrita.
  mockFonte({ falhaQuilombola: true });
  const falha = await verificarSobreposicoes(ativo, { usarCache: false });
  const quil = falha.find(v => v.chave === "sobreposicao_quilombola")!;
  assert.equal(quil.estado, "sem_dado");
  assert.equal(quil.achado, "indeterminado");
  assert.equal(quil.valor, null);
  assert.match(quil.observacao!, /HTTP 503/);
  assert.ok(falha.filter(v => ["sobreposicao_ti", "sobreposicao_uc"].includes(v.chave)).every(v => v.estado === "indicado"));

  mockFonte({ positivas: true });
  const positivas = await consultarSobreposicoes(ativo.lat, ativo.lon, null, 0.15, ativo.bbox, { usarCache: false });
  assert.ok(positivas);
  assert.equal(positivas.terrasIndigenas[0].nome, "Nome oficial");
  assert.equal(positivas.terrasIndigenas[0].categoria, "Regularizada");
  assert.equal(positivas.quilombolas[0].categoria, "TITULADO");
  assert.equal(positivas.unidadesConservacao[0].categoria, "Parque Nacional");
  assert.equal(positivas.unidadesConservacao[0].nivelRisco, "alto");
  assert.equal(positivas.geoJsonFeatures!.length, 3);
  assert.equal(positivas.riscoMaximo, "alto");
  console.log("verificacoes-sobreposicoes: origem, atributos e falha = sem_dado passaram");
} finally {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
}
